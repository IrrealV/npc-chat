import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { BridgeError } from './rpc.js';

export type PersistentProfile = { base: string; home: string; lock: string; accountHome: string; root: string };
export type ProfileOptions = { accountHome?: string; xdgStateHome?: string; repoRoot?: string };

const STATE_DIRECTORY = 'npc-chat';
const HOME_DIRECTORY = 'codex-home';
const LOCK_FILENAME = 'codex.lock';

const unsafe = (code: string): never => {
  throw new BridgeError(code);
};

function within(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

// Pure layout resolution: never touches the filesystem, so an unsafe explicit
// location is rejected before any mutation.
export function resolveProfile(options: ProfileOptions = {}): PersistentProfile {
  const accountHome = options.accountHome ?? userInfo().homedir;
  const xdgStateHome = options.xdgStateHome ?? process.env.XDG_STATE_HOME;
  const repoRoot = options.repoRoot ?? process.cwd();
  if (typeof accountHome !== 'string' || !isAbsolute(accountHome)) unsafe('persistent_profile_invalid_location');
  const home = resolve(accountHome);
  let base: string;
  let root: string;
  if (typeof xdgStateHome === 'string' && xdgStateHome.length > 0) {
    if (!isAbsolute(xdgStateHome) || resolve(xdgStateHome) === parse(xdgStateHome).root) unsafe('persistent_profile_unsafe_xdg');
    root = resolve(xdgStateHome);
    base = join(root, STATE_DIRECTORY);
  } else {
    root = home;
    base = join(home, '.local', 'state', STATE_DIRECTORY);
  }
  const principal = join(home, '.codex');
  if (within(repoRoot, base) || within(principal, base)) unsafe('persistent_profile_invalid_location');
  const stateHome = join(base, HOME_DIRECTORY);
  const lock = join(base, LOCK_FILENAME);
  if (dirname(stateHome) !== base || dirname(lock) !== base) unsafe('persistent_profile_invalid_location');
  return { base, home: stateHome, lock, accountHome: home, root };
}

async function existingState(path: string): Promise<Stats | undefined> {
  return await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    return unsafe('persistent_profile_unsafe_metadata');
  });
}

// Walk every existing path component and reject symlinks or non-directories
// before the first mutation, so a redirected ancestor above an explicit XDG
// root can never funnel creation outside the app profile.
async function assertCanonicalAncestry(target: string): Promise<void> {
  const absolute = resolve(target);
  let cursor = parse(absolute).root;
  for (const part of absolute.split(sep).filter((value) => value.length > 0)) {
    cursor = join(cursor, part);
    const state = await existingState(cursor);
    if (state === undefined) return;
    if (state.isSymbolicLink() || !state.isDirectory()) unsafe('persistent_profile_unsafe_metadata');
  }
}

function ancestorChain(root: string, target: string): string[] {
  const chain: string[] = [];
  let cursor = resolve(target);
  for (;;) {
    chain.unshift(cursor);
    if (cursor === root) break;
    const parent = dirname(cursor);
    if (parent === cursor || !within(root, cursor)) unsafe('persistent_profile_unsafe_metadata');
    cursor = parent;
  }
  return chain;
}

// Existing trusted ancestors only need to be owned and not group/world
// writable; they are never repaired or re-parented.
async function assertTrustedAncestor(path: string, uid: number): Promise<void> {
  const state = await existingState(path);
  if (state === undefined) return;
  if (state.isSymbolicLink() || !state.isDirectory() || state.uid !== uid || (state.mode & 0o022) !== 0) {
    unsafe('persistent_profile_unsafe_metadata');
  }
}

async function assertPrivateDirectory(path: string, uid: number): Promise<void> {
  const state = await existingState(path);
  if (state === undefined) return;
  if (state.isSymbolicLink() || !state.isDirectory() || state.uid !== uid || (state.mode & 0o777) !== 0o700) {
    unsafe('persistent_profile_unsafe_metadata');
  }
}

async function assertPrivateFile(path: string, uid: number): Promise<void> {
  const state = await existingState(path);
  if (state === undefined) return;
  if (state.isSymbolicLink() || !state.isFile() || state.uid !== uid
    || (state.mode & 0o777) !== 0o600 || state.nlink !== 1) {
    unsafe('persistent_profile_unsafe_metadata');
  }
}

async function makeAncestors(root: string, target: string, uid: number): Promise<void> {
  for (const path of ancestorChain(root, target)) {
    if ((await existingState(path)) === undefined) {
      await mkdir(path, { mode: 0o700 }).catch(() => unsafe('persistent_profile_unsafe_metadata'));
    }
    await assertTrustedAncestor(path, uid);
  }
}

async function ensureDirectory(path: string, uid: number): Promise<void> {
  if ((await existingState(path)) === undefined) {
    await mkdir(path, { mode: 0o700 }).catch(() => unsafe('persistent_profile_unsafe_metadata'));
  }
  await assertPrivateDirectory(path, uid);
}

async function ensurePrivateFile(path: string, uid: number, create: boolean): Promise<void> {
  if ((await existingState(path)) === undefined) {
    if (!create) return;
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      .catch(() => unsafe('persistent_profile_unsafe_metadata'));
    await handle.close();
  }
  await assertPrivateFile(path, uid);
}

// Metadata-only preparation. Every existing path is validated before the first
// mutation, and existing native state is never repaired, read, copied or removed.
export async function prepareProfile(profile: PersistentProfile): Promise<PersistentProfile> {
  if (process.platform !== 'linux' || process.arch !== 'x64') unsafe('persistent_profile_unsupported_platform');
  const uid = process.getuid?.();
  if (uid === undefined) throw new BridgeError('persistent_profile_unsupported_platform');
  const auth = join(profile.home, 'auth.json');

  await assertCanonicalAncestry(profile.base);
  for (const path of ancestorChain(profile.root, profile.base)) await assertTrustedAncestor(path, uid);
  await assertPrivateDirectory(profile.base, uid);
  await assertPrivateFile(profile.lock, uid);
  await assertPrivateDirectory(profile.home, uid);
  await assertPrivateFile(auth, uid);

  await makeAncestors(profile.root, profile.base, uid);
  await ensureDirectory(profile.base, uid);
  await ensurePrivateFile(profile.lock, uid, true);
  await ensureDirectory(profile.home, uid);
  await ensurePrivateFile(auth, uid, false);

  for (const path of [profile.base, profile.home]) {
    if ((await realpath(path)) !== resolve(path)) unsafe('persistent_profile_unsafe_metadata');
  }
  return profile;
}
