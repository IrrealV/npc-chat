import { describe, expect, it } from 'vitest';
import { sandboxArgs } from '../src/codex/isolation.js';

describe('outer sandbox policy', () => {
  it('starts from an empty filesystem and environment, not a host root bind', () => {
    const args = sandboxArgs('/selected/codex', ['--version']);
    expect(args).toContain('--unshare-all');
    expect(args).toContain('--clearenv');
    expect(args).toContain('--die-with-parent');
    expect(args).toContain('--new-session');
    expect(args).not.toContain('--share-net');
    expect(args.join(' ')).not.toContain('--ro-bind / /');
    expect(args.join(' ')).not.toContain('--bind / /');
    expect(args).not.toContain(process.cwd());
    expect(args).not.toContain(process.env.HOME);
    expect(args).not.toContain('OPENAI_API_KEY');
    expect(args).not.toContain('DBUS_SESSION_BUS_ADDRESS');
    const mounts = args.flatMap((value, index) => value === '--ro-bind' || value === '--bind' ? [args[index + 1]] : []);
    expect(mounts).toEqual(['/selected/codex', '/usr/bin/bwrap',
      '/etc/ssl/certs', '/usr/share/ca-certificates', '/etc/resolv.conf', '/etc/hosts',
      '/lib/x86_64-linux-gnu/libselinux.so.1', '/lib/x86_64-linux-gnu/libcap.so.2',
      '/lib/x86_64-linux-gnu/libc.so.6', '/lib/x86_64-linux-gnu/libpcre2-8.so.0',
      '/lib64/ld-linux-x86-64.so.2']);
    const environment = args.flatMap((value, index) => value === '--setenv' ? [args[index + 1]] : []);
    expect(environment).toEqual(['HOME', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
      'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'PATH', 'LANG', 'SSL_CERT_FILE']);
  });
  it('provides inner bubblewrap on the restricted PATH without broad runtime mounts', () => {
    const args = sandboxArgs('/selected/codex', ['app-server'], true);
    const mounts = args.flatMap((value, index) => value === '--ro-bind' ? [[args[index + 1], args[index + 2]]] : []);
    expect(mounts).toContainEqual(['/usr/bin/bwrap', '/bin/bwrap']);
    for (const [source, destination] of mounts.filter(([source]) => source.startsWith('/lib'))) {
      expect(destination).toBe(source);
    }
    expect(args.join(' ')).toContain('--setenv PATH /bin');
    expect(args.join(' ')).toContain('--cap-drop ALL');
    for (const directory of ['/', '/usr', '/lib', '/lib64', '/usr/lib/x86_64-linux-gnu', '/lib/x86_64-linux-gnu']) {
      expect(mounts.some(([source]) => source === directory)).toBe(false);
    }
    expect(args).not.toContain('/usr/bin/dash');
  });
  it('shares networking only for explicitly requested official server operations', () => {
    expect(sandboxArgs('/selected/codex', ['app-server'], true)).toContain('--share-net');
    expect(sandboxArgs('/selected/codex', ['app-server'], false)).not.toContain('--share-net');
  });
});
