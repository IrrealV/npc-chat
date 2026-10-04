import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareProfile, resolveProfile, type PersistentProfile } from '../src/codex/profile.js';

const created: string[] = [];
async function temp(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}
function codeOf(fn: () => unknown): string {
  try { fn(); } catch (error) { return (error as { code?: string }).code ?? ''; }
  return 'no_error';
}
async function asyncCode(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (error) { return (error as { code?: string }).code ?? ''; }
  return 'no_error';
}
// Captures every owned path, kind, mode, link count and non-secret bytes so a
// rejected preparation can be proven to have mutated nothing.
async function snapshotTree(root: string): Promise<string[]> {
  const lines: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const full = join(directory, name);
      const state = await lstat(full);
      const rel = `${prefix}${name}`;
      const kind = state.isSymbolicLink() ? 'link' : state.isDirectory() ? 'dir' : 'file';
      const body = state.isFile() ? (await readFile(full)).toString('base64')
        : state.isSymbolicLink() ? await readlink(full) : '';
      lines.push(`${rel} ${kind} ${(state.mode & 0o777).toString(8)} ${state.nlink} ${body}`);
      if (state.isDirectory()) await walk(full, `${rel}/`);
    }
  };
  await walk(root, '');
  return lines;
}
// R3 isolation guard: every filesystem fixture must resolve inside one of the
// registered OWNED temporary roots before it mutates anything. `relative`
// rejects sibling-prefix escapes (/tmp/a vs /tmp/ab) that a raw prefix check
// would wrongly accept.
function inOwnedRoot(path: string): boolean {
  return created.some((root) => {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}
function assertOwned(profile: PersistentProfile): PersistentProfile {
  expect([profile.base, profile.home, profile.lock].map(inOwnedRoot)).toEqual([true, true, true]);
  return profile;
}
// An empty explicit XDG_STATE_HOME forces the home-based layout regardless of
// any inherited process environment; fixtures must never fall back to the
// ambient value.
function ownedProfile(accountHome: string): PersistentProfile {
  return assertOwned(resolveProfile({ accountHome, xdgStateHome: '', repoRoot: '/nonexistent-repo' }));
}

// A base directory that already exists, so the case under test is the only
// unsafe state and the lock must never be created ahead of rejection.
async function preparedBase(accountHome: string): Promise<PersistentProfile> {
  const profile = ownedProfile(accountHome);
  await mkdir(profile.base, { recursive: true, mode: 0o700 });
  await chmod(profile.base, 0o700);
  return profile;
}
afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('persistent profile layout', () => {
  it('resolves a private layout under the OS account home, never the sanitized HOME', async () => {
    const accountHome = await temp('npc-home-');
    const decoy = await temp('npc-decoy-');
    const previous = process.env.HOME;
    process.env.HOME = decoy;
    try {
      const profile = ownedProfile(accountHome);
      expect(profile).toEqual({
        base: join(accountHome, '.local', 'state', 'npc-chat'),
        home: join(accountHome, '.local', 'state', 'npc-chat', 'codex-home'),
        lock: join(accountHome, '.local', 'state', 'npc-chat', 'codex.lock'),
        accountHome,
        root: accountHome,
      });
      expect(profile.base.startsWith(decoy)).toBe(false);
    } finally { process.env.HOME = previous; }
  });

  it('defaults the account home to the OS account database, independent of HOME', () => {
    const previous = process.env.HOME;
    process.env.HOME = join(tmpdir(), 'npc-decoy-never');
    try {
      const profile = resolveProfile({ xdgStateHome: '', repoRoot: '/nonexistent-repo' });
      expect(profile.accountHome).toBe(userInfo().homedir);
      expect(profile.root).toBe(userInfo().homedir);
      expect(profile.base).toBe(join(userInfo().homedir, '.local', 'state', 'npc-chat'));
    } finally { process.env.HOME = previous; }
  });

  it('accepts an absolute XDG_STATE_HOME and rejects unsafe explicit locations', async () => {
    const accountHome = await temp('npc-home-');
    const state = await temp('npc-state-');
    expect(resolveProfile({ accountHome, xdgStateHome: state, repoRoot: '/nonexistent-repo' }).base)
      .toBe(join(state, 'npc-chat'));
    expect(codeOf(() => resolveProfile({ accountHome, xdgStateHome: 'relative/state', repoRoot: '/nonexistent-repo' })))
      .toBe('persistent_profile_unsafe_xdg');
    expect(codeOf(() => resolveProfile({ accountHome, xdgStateHome: join(accountHome, '.codex', 'state'), repoRoot: '/nonexistent-repo' })))
      .toBe('persistent_profile_invalid_location');
    expect(codeOf(() => resolveProfile({ accountHome, xdgStateHome: '/', repoRoot: '/nonexistent-repo' })))
      .toBe('persistent_profile_unsafe_xdg');
  });

  it('rejects a location inside the repository or the principal Codex home', async () => {
    const accountHome = await temp('npc-home-');
    const repo = await temp('npc-repo-');
    expect(codeOf(() => resolveProfile({ accountHome, xdgStateHome: repo, repoRoot: repo })))
      .toBe('persistent_profile_invalid_location');
    expect(codeOf(() => resolveProfile({ accountHome, xdgStateHome: join(accountHome, '.codex'), repoRoot: '/nonexistent-repo' })))
      .toBe('persistent_profile_invalid_location');
    expect(codeOf(() => resolveProfile({ accountHome: 'relative-home', repoRoot: '/nonexistent-repo' })))
      .toBe('persistent_profile_invalid_location');
  });
});

describe('persistent profile preparation', () => {
  it('keeps the fixture inside its intended owned root when an external XDG_STATE_HOME is inherited', async () => {
    const accountHome = await temp('npc-home-');
    const external = await temp('npc-inherited-xdg-');
    const sentinel = join(external, 'sentinel.txt');
    await writeFile(sentinel, 'NONSECRET', { mode: 0o600 });
    const externalBefore = await snapshotTree(external);
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = external;
    try {
      const profile = await prepareProfile(ownedProfile(accountHome));
      expect(profile.base).toBe(join(accountHome, '.local', 'state', 'npc-chat'));
      expect(await snapshotTree(external)).toEqual(externalBefore);
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  });

  it('creates owned 0700 directories and a 0600 single-link lock without reading native auth data', async () => {
    const accountHome = await temp('npc-home-');
    const profile = await prepareProfile(ownedProfile(accountHome));
    const base = await stat(profile.base);
    const home = await stat(profile.home);
    const lock = await stat(profile.lock);
    expect(base.isDirectory()).toBe(true);
    expect(base.mode & 0o777).toBe(0o700);
    expect(home.mode & 0o777).toBe(0o700);
    expect(lock.isFile()).toBe(true);
    expect(lock.mode & 0o777).toBe(0o600);
    expect(lock.nlink).toBe(1);
    const inode = lock.ino;
    // Opaque native state is metadata only: unparsable content must not be read or rejected.
    await writeFile(join(profile.home, 'auth.json'), '{not json', { mode: 0o600 });
    await chmod(join(profile.home, 'auth.json'), 0o600);
    await expect(prepareProfile(profile)).resolves.toEqual(profile);
    expect((await stat(profile.lock)).ino).toBe(inode);
  });

  it('rejects an unsafely permissioned lock and never repairs it', async () => {
    const accountHome = await temp('npc-home-');
    const profile = ownedProfile(accountHome);
    await mkdir(profile.base, { recursive: true, mode: 0o700 });
    await writeFile(profile.lock, '', { mode: 0o644 });
    await chmod(profile.lock, 0o644);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    expect((await stat(profile.lock)).mode & 0o777).toBe(0o644);
  });

  it('rejects a symlinked lock or home and a multiply-linked lock', async () => {
    const accountHome = await temp('npc-home-');
    const profile = ownedProfile(accountHome);
    await mkdir(profile.base, { recursive: true, mode: 0o700 });
    const target = join(accountHome, 'target');
    await writeFile(target, '', { mode: 0o600 });
    await symlink(target, profile.lock);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    await rm(profile.lock);
    await writeFile(profile.lock, '', { mode: 0o600 });
    await link(profile.lock, join(accountHome, 'second-link'));
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    await rm(join(accountHome, 'second-link'));
    await rm(profile.lock);
    const realHome = join(accountHome, 'real-home');
    await mkdir(realHome, { mode: 0o700 });
    await symlink(realHome, profile.home);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
  });

  it('rejects a group- or world-writable trusted ancestor before creating the profile', async () => {
    const accountHome = await temp('npc-home-');
    await mkdir(join(accountHome, '.local'), { mode: 0o700 });
    await chmod(join(accountHome, '.local'), 0o777);
    const profile = ownedProfile(accountHome);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    await expect(stat(profile.base)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an unsafely permissioned auth.json without reading or repairing it', async () => {
    const accountHome = await temp('npc-home-');
    const profile = await prepareProfile(ownedProfile(accountHome));
    const auth = join(profile.home, 'auth.json');
    await writeFile(auth, '{not json', { mode: 0o644 });
    await chmod(auth, 0o644);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    expect((await stat(auth)).mode & 0o777).toBe(0o644);
  });

  it('creates an explicit XDG_STATE_HOME profile without touching the account home state', async () => {
    const accountHome = await temp('npc-home-');
    const state = await temp('npc-state-');
    const profile = await prepareProfile(assertOwned(resolveProfile({ accountHome, xdgStateHome: state, repoRoot: '/nonexistent-repo' })));
    expect(profile.base).toBe(join(state, 'npc-chat'));
    expect((await stat(profile.home)).mode & 0o777).toBe(0o700);
    await expect(stat(join(accountHome, '.local'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a non-directory or symlinked profile base without repair', async () => {
    const fileHome = await temp('npc-home-');
    await mkdir(join(fileHome, '.local', 'state'), { recursive: true, mode: 0o700 });
    const fileProfile = ownedProfile(fileHome);
    await writeFile(fileProfile.base, 'not a directory', { mode: 0o600 });
    expect(await asyncCode(() => prepareProfile(fileProfile))).toBe('persistent_profile_unsafe_metadata');
    expect((await stat(fileProfile.base)).isFile()).toBe(true);

    const linkHome = await temp('npc-home-');
    await mkdir(join(linkHome, '.local', 'state'), { recursive: true, mode: 0o700 });
    const linkProfile = ownedProfile(linkHome);
    const realBase = join(linkHome, 'real-base');
    await mkdir(realBase, { mode: 0o700 });
    await symlink(realBase, linkProfile.base);
    expect(await asyncCode(() => prepareProfile(linkProfile))).toBe('persistent_profile_unsafe_metadata');
  });

  it('accepts owned non-writable ancestors that are not themselves 0700', async () => {
    const accountHome = await temp('npc-home-');
    await mkdir(join(accountHome, '.local', 'state'), { recursive: true, mode: 0o755 });
    await chmod(join(accountHome, '.local'), 0o755);
    await chmod(join(accountHome, '.local', 'state'), 0o755);
    const profile = await prepareProfile(ownedProfile(accountHome));
    expect((await stat(profile.base)).mode & 0o777).toBe(0o700);
    expect((await stat(join(accountHome, '.local'))).mode & 0o777).toBe(0o755);
    expect((await stat(profile.lock)).mode & 0o777).toBe(0o600);
  });
});

describe('persistent profile rejection is side-effect free', () => {
  const unsafeStates: Array<[string, (accountHome: string) => Promise<PersistentProfile>]> = [
    ['an unsafe auth file mode', async (accountHome) => {
      const profile = await preparedBase(accountHome);
      await mkdir(profile.home, { mode: 0o700 });
      await writeFile(join(profile.home, 'auth.json'), '{not json', { mode: 0o600 });
      await chmod(join(profile.home, 'auth.json'), 0o644);
      return profile;
    }],
    ['a symlinked auth file', async (accountHome) => {
      const profile = await preparedBase(accountHome);
      await mkdir(profile.home, { mode: 0o700 });
      const target = join(accountHome, 'target-auth');
      await writeFile(target, '{not json', { mode: 0o600 });
      await symlink(target, join(profile.home, 'auth.json'));
      return profile;
    }],
    ['a multiply-linked auth file', async (accountHome) => {
      const profile = await preparedBase(accountHome);
      await mkdir(profile.home, { mode: 0o700 });
      const auth = join(profile.home, 'auth.json');
      await writeFile(auth, '{not json', { mode: 0o600 });
      await link(auth, join(accountHome, 'second-link'));
      return profile;
    }],
    ['a directory at the auth path', async (accountHome) => {
      const profile = await preparedBase(accountHome);
      await mkdir(profile.home, { mode: 0o700 });
      await mkdir(join(profile.home, 'auth.json'), { mode: 0o700 });
      return profile;
    }],
    ['a regular file at the codex home', async (accountHome) => {
      const profile = await preparedBase(accountHome);
      await writeFile(profile.home, 'not a directory', { mode: 0o600 });
      return profile;
    }],
  ];

  it.each(unsafeStates)('rejects %s without creating the lock or mutating any owned path', async (_name, build) => {
    const accountHome = await temp('npc-home-');
    const profile = await build(accountHome);
    const before = await snapshotTree(accountHome);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    expect(await snapshotTree(accountHome)).toEqual(before);
    await expect(stat(profile.lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an ancestor symlink above an explicit XDG root before creating anything', async () => {
    const accountHome = await temp('npc-home-');
    const outer = await temp('npc-xdg-outer-');
    const escaped = await temp('npc-xdg-target-');
    await symlink(escaped, join(outer, 'link'));
    const profile = assertOwned(resolveProfile({ accountHome, xdgStateHome: join(outer, 'link', 'state'), repoRoot: '/nonexistent-repo' }));
    const outerBefore = await snapshotTree(outer);
    const escapedBefore = await snapshotTree(escaped);
    expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
    expect(await snapshotTree(outer)).toEqual(outerBefore);
    expect(await snapshotTree(escaped)).toEqual(escapedBefore);
    await expect(stat(join(escaped, 'state'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a foreign-owned profile before creating anything', async () => {
    const accountHome = await temp('npc-home-');
    const profile = ownedProfile(accountHome);
    const uid = process.getuid!();
    const spy = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    try {
      const before = await snapshotTree(accountHome);
      expect(await asyncCode(() => prepareProfile(profile))).toBe('persistent_profile_unsafe_metadata');
      expect(await snapshotTree(accountHome)).toEqual(before);
    } finally { spy.mockRestore(); }
  });
});
