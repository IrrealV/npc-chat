# Persistent Codex authentication

`npc:chat`, `npc:session`, and `npc:serve` reuse one app-owned Codex sign-in across
normal shutdown and restart. The first run still performs the managed ChatGPT
device-code ceremony; later runs read the existing account and skip it. Closing
the application is not logout.

This document describes the storage, isolation, and logout behavior. Native
runtime behavior is not established by the synthetic tests; see
[Human acceptance](#human-acceptance).

## Plaintext storage disclosure

Codex's official file storage writes its credentials to `auth.json` in plain
text. It is protected only by operating-system file permissions, not by
encryption or an OS keyring. The app also does not claim crash-proof
credentials: Codex creates that file with truncate/create/write/flush, not an
atomic replacement or `fsync`.

The app never reads, copies, serializes, or logs credential contents. It only
inspects directory and file metadata.

## Location

The default profile lives outside the repository and separate from the user's
personal Codex login:

| Path | Mode | Purpose |
| --- | --- | --- |
| `<OS account home>/.local/state/npc-chat` | `0700` | Private app state directory |
| `<OS account home>/.local/state/npc-chat/codex-home` | `0700` | Dedicated `CODEX_HOME` (whole directory persisted) |
| `<OS account home>/.local/state/npc-chat/codex.lock` | `0600` | Sibling kernel lock file (single link) |

The location uses the operating-system account home (`userInfo().homedir`), not
the `HOME` environment variable, which the isolation toolchain clears.

An explicit absolute `XDG_STATE_HOME` is honored and produces
`<XDG_STATE_HOME>/npc-chat`. It must be absolute and outside the repository and
the principal `~/.codex`. An unsafe explicit value is rejected rather than
silently ignored. The toolchain wrapper does not set or change this variable.

Existing app directories must be owned real directories with mode `0700`.
Existing `codex.lock` and `auth.json` must be regular owner-matched,
single-link files with mode `0600`; only metadata is inspected. Every existing
path, including all ancestors, is validated before the first mutation, so a
rejected profile is never partially created and an unsafe state is never
auto-repaired, deleted, or followed through a symlink.

## Isolation

The dedicated `codex-home` is bound read-write into the disposable bubblewrap
sandbox. Each other `HOME`/XDG location, `/tmp`, the workspace, the host home,
and any keyring remain ephemeral; there is no host-home, repository, or keyring
mount. Only the credential store mode changes to Codex's `file` mode; every
other safety override (forced ChatGPT login, disabled history, disabled tools,
disabled Apps/agents/memories, read-only threads, approvals) is preserved and
verified against the effective configuration.

Kernel lock ownership lives inside the sandbox. The pinned entrypoint is fixed:

```text
bwrap ... -- /bin/flock -n -E 100 /lock/owner.lock /bin/codex <command...>
```

Only the whole dedicated `codex-home` and the validated sibling `codex.lock`
are bound. The installed `flock` binary is bound read-only, and the baseline
inner `bwrap` and runtime read-only binds are preserved. The lock file is never
unlinked, including at logout.

If another product process or a logout already holds the profile, `flock` exits
with status `100` before the protocol handshake. The app maps only that
positively observed pre-initialization conflict to the fixed `profile_busy`
error; it never infers contention from stderr or from a later provider exit.

## Logout

```sh
.local/toolchains/run-npm run npc:logout -- --confirm
```

`npc:logout` starts the same persistent bridge under the same lock, calls
`account/logout` with the `params` member omitted (the pinned request is
`Option<()>`), validates the response as an empty plain object, and closes. A
missing or non-empty result, including `null`, fails closed as an unconfirmed
logout. It does not start a login, run inference, or delete the profile, lock,
or other native state.

`--help` must be used alone and is side-effect free. The command requires
`--confirm` and both interactive stdin and stderr. It follows the existing
signal and cancellation conventions. An interrupted or uncertain logout is
never reported as confirmed success, and it is not blindly retried.

Successful output is the fixed record `{"loggedOut":true}`. This is a local
logout. Remote revocation is best effort and is not guaranteed.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `persistent_profile_unsupported_platform` | Not Linux x64, or no numeric UID |
| `persistent_profile_invalid_location` | Account home or base resolves inside the repository or principal `~/.codex` |
| `persistent_profile_unsafe_xdg` | Explicit `XDG_STATE_HOME` is relative or the filesystem root |
| `persistent_profile_unsafe_metadata` | Unsafe existing directory, lock, or `auth.json` metadata |
| `profile_busy` | The profile lock is held by another process before the handshake |
| `logout_failed` | The logout result was not an empty plain object, or logout was uncertain |

Diagnostics contain fixed codes only. They never include credential contents,
private resolved paths, or raw filesystem or provider errors.

## Limits

The whole dedicated `codex-home` is persisted. Codex may retain additional
native state there, so this is not a promise of auth-only storage nor of the
absence of logs. Same-UID malicious processes and privileged OS attackers are
outside this boundary.

Session revocation, a failed refresh, or damaged native auth storage can still
require user intervention. Persistence is not permanent access.

## Human acceptance

After technical approval, verify in your environment:

1. First authenticated run performs the ceremony and one text turn.
2. Close and restart reuses the sign-in with no ceremony.
3. `npc:logout -- --confirm` signs out locally, and the next run asks again.
4. A second simultaneous product process is rejected with `profile_busy`.
5. Real signal handling and cleanup of the sandboxed `flock`/Codex processes.
