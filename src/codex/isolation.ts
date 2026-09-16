import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export const VERSION = '0.154.0';
export const LOCAL = resolve('.local/batch1');

// Audited with ldd /usr/bin/bwrap on the supported Linux x64 host.
// Fixed SONAME paths only: no library scanning, directory mounts, or fallback.
const BWRAP_RUNTIME = [
  '/lib/x86_64-linux-gnu/libselinux.so.1',
  '/lib/x86_64-linux-gnu/libcap.so.2',
  '/lib/x86_64-linux-gnu/libc.so.6',
  '/lib/x86_64-linux-gnu/libpcre2-8.so.0',
  '/lib64/ld-linux-x86-64.so.2',
];

// Only this file is exposed from the Codex package, never the package or repository.
export async function codexBinary(): Promise<string> {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('unsupported_platform');
  return realpath(resolve('node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex'));
}

export function sandboxArgs(binary: string, command: string[], network = false): string[] {
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--cap-drop', 'ALL'];
  if (network) args.push('--share-net');
  args.push('--clearenv', '--tmpfs', '/', '--proc', '/proc', '--dev', '/dev',
    '--dir', '/bin', '--ro-bind', binary, '/bin/codex',
    '--ro-bind', '/usr/bin/bwrap', '/bin/bwrap',
    '--dir', '/etc', '--dir', '/etc/ssl',
    '--ro-bind', '/etc/ssl/certs', '/etc/ssl/certs',
    '--ro-bind', '/usr/share/ca-certificates', '/usr/share/ca-certificates',
    '--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf',
    '--ro-bind', '/etc/hosts', '/etc/hosts',
    '--tmpfs', '/tmp', '--tmpfs', '/home', '--dir', '/home/probe',
    '--dir', '/home/probe/.codex', '--dir', '/home/probe/config',
    '--dir', '/home/probe/cache', '--dir', '/home/probe/data',
    '--dir', '/home/probe/state', '--dir', '/home/probe/runtime',
    '--dir', '/work', '--chdir', '/work');
  for (const library of BWRAP_RUNTIME) args.push('--ro-bind', library, library);
  for (const [key, value] of Object.entries({
    HOME: '/home/probe', CODEX_HOME: '/home/probe/.codex',
    XDG_CONFIG_HOME: '/home/probe/config', XDG_CACHE_HOME: '/home/probe/cache',
    XDG_DATA_HOME: '/home/probe/data', XDG_STATE_HOME: '/home/probe/state',
    XDG_RUNTIME_DIR: '/home/probe/runtime', PATH: '/bin', LANG: 'C.UTF-8',
    SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
  })) args.push('--setenv', key, value);
  args.push('--', '/bin/codex', ...command);
  return args;
}

export async function spawnIsolated(command: string[], options: {
  network?: boolean; output?: string; check?: string;
} = {}): Promise<ChildProcessWithoutNullStreams> {
  await mkdir(LOCAL, { recursive: true, mode: 0o700 });
  const cwd = await mkdtemp(`${LOCAL}/run-`);
  const args = sandboxArgs(await codexBinary(), command, options.network);
  const boundary = args.indexOf('--');
  if (options.output) {
    const output = resolve(options.output);
    if (!output.startsWith(`${LOCAL}/schema-`)) throw new Error('invalid_schema_output');
    await mkdir(output, { recursive: true, mode: 0o700 });
    args.splice(boundary, 0, '--bind', output, '/output');
  }
  if (options.check) {
    // A check-only system shell checks existence, never reads personal files.
    args.splice(args.indexOf('--'), 0, '--ro-bind', '/usr/bin/dash', '/check');
    args.splice(args.indexOf('--') + 1, args.length, '/check', '-c', options.check);
  }
  return spawn('/usr/bin/bwrap', args, {
    cwd, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: 'pipe',
  });
}

export async function captureIsolated(command: string[], options: Parameters<typeof spawnIsolated>[1] = {}): Promise<string> {
  const child = await spawnIsolated(command, options);
  return new Promise((resolveOutput, reject) => {
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 2_000_000) child.kill('SIGKILL');
    });
    child.stderr.resume(); // Never surface raw process diagnostics.
    child.on('error', () => { clearTimeout(timer); reject(new Error('isolation_launch_failed')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('isolation_or_command_failed'));
      else resolveOutput(output);
    });
    child.stdin.end();
  });
}
