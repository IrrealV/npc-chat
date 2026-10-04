# Persistent Codex authentication

## Authorization

The user explicitly chose app-owned file-backed persistence after disclosure that Codex's official file storage is plaintext, protected by OS permissions, outside the repository and separate from personal Codex authentication (Engram 21107). Product commands must reuse sign-in across normal shutdown/restart. Closing the application is not logout. No global/keyring integration, principal credential access, external-token auth, installations, native Codex/auth/inference/isolation probes, browser/OBS operation or Git delivery is authorized. Implementation tests may use temporary nonsecret fixtures and the already-installed flock utility; never the live profile.

## Confirmed evidence

At diagnosis, src/codex/policy.ts forced ephemeral credentials and isolation.ts supplied disposable HOME/CODEX_HOME. bridge.login already checked account/read before starting a ceremony. The toolchain wrapper sanitizes HOME to an in-repository directory, so the default persistent location must use the OS account home from userInfo().homedir, not HOME or os.homedir().

Parent fetched OpenAI's rust-v0.154.0 tag, resolving to commit 6b9826e3aa83b1a5947db50f4332cb9c65f1b340. Under codex-rs:
- login/src/auth/storage.rs: file storage is CODEX_HOME/auth.json, truncate/create/write/flush, mode 0600 on Unix creation. It is NOT atomic replacement or fsync. The app must not read/copy/serialize tokens or claim crash-proof credentials.
- config/src/types.rs: lowercase file/keyring/auto/ephemeral modes.
- login/src/auth/manager.rs: managed refresh and per-manager semaphore, not established cross-process exclusivity.
- app-server/src/request_processors/account_processor.rs: account/read discards forced-refresh outcome before returning account state. Keep refreshToken:false and managed refresh; no invented expiry enum, forced refresh validation, automatic credential deletion or generation replay. Logout clears local auth; remote revocation is best-effort.
- app-server-protocol/src/protocol/common.rs: account/logout params are Option<()> / TypeScript undefined. OMIT params, do not send {}. Empty response does not imply empty-object request.

Source URLs use https://raw.githubusercontent.com/openai/codex/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/ followed by these paths. No live generated-schema validation is claimed: the mapper's cited v2/ClientRequest.json path returned ENOENT on parent read. Do not generate schemas or run Codex to repair that absence. Existing runtime protocol/version gates remain mandatory. Parent observed /usr/bin/flock and its help; ldd found only libc and the ELF loader already in the fixed sandbox runtime allowlist.

## Design and safety contract

- Linux x64 only, matching current support. One app profile, no account-switching or configurable arbitrary credential path. Default <OS-account-home>/.local/state/npc-chat/codex-home; sibling codex.lock under private npc-chat directory. A supplied XDG_STATE_HOME must be absolute, safe and outside the repository/principal Codex; reject unsafe explicit configuration rather than silently falling back. The wrapper currently clears this variable; do not change the wrapper/global environment.
- Profile/app directories are owned real directories, 0700. Existing lock and auth.json must be regular non-symlink files, owner-matched, mode 0600 and single-link; inspect metadata only. Validate trusted ancestors and canonical containment before mutation. Reject unsafe existing state with fixed diagnostic codes; never chmod, delete or repair it automatically. No secret-bearing file contents, private resolved paths or raw filesystem/provider errors in output. Same-UID malicious processes and privileged OS attackers are outside this boundary.
- Bind the whole dedicated Codex home, not a single auth file or invented auth subdirectory. Keep workspace, other HOME/XDG locations and /tmp ephemeral, no host home/repo/keyring mounts. Only authentication storage mode changes to file; preserve every other safety configuration and its effective-config checks, ephemeral threads, history disabled, tool restrictions and approvals. Whole-home persistence can retain additional Codex-managed state; do not promise auth-only storage or absence of every log/state artifact.
- Kernel ownership belongs inside the sandbox: bwrap launches /bin/flock -n -E 100 /lock/owner.lock /bin/codex with fixed argv, no shell. Read-only bind the installed flock binary and bind the validated sibling lock file. Default flock forks/waits and its descriptor is inherited; it does not replace itself via exec as -F would. Keep existing bwrap parent-death/PID-namespace protections. Never unlink the lock inode, even at logout; no PID-marker takeover, retry queue or forced takeover.
- A second product process or logout must fail safely while the profile is held. Map a positively observed pre-initialization conflict exit to a fixed busy error; do not infer from stderr or confuse later provider exit with lock contention. Clean up early-exit listeners, startup failures and cancellation without weakening the frozen Rpc transport. Lock lifecycle tests are REQUIRED in this batch with non-Codex children, not deferred. Actual bwrap/Codex signal behavior remains a human integration check.
- Add a persistent bridge startup path shared by npc:chat, npc:session and npc:serve entrypoints. The default bridge/probe path remains ephemeral; diagnostic codex:* behavior stays unchanged. Preserve login account validation and missing-account ceremony; network/transport errors do not imply logout or trigger arbitrary reauthentication/retry.
- Add npc:logout --confirm, with strict options, side-effect-free help, human terminal gates and existing signal/cancellation conventions. It starts the persistent bridge under the same lock, sends account/logout with omitted params, validates success and closes without calling login/inference. Print only fixed safe output. Do not remove the profile, lock or other native state. Do not claim remote revocation is guaranteed; an interrupted/uncertain logout cannot be reported as confirmed success or blindly retried.

## Exact writer surfaces

src/codex/isolation.ts
src/codex/policy.ts
src/codex/bridge.ts
src/codex/schema.ts
src/codex/profile.ts
src/npc/logout-cli.ts
scripts/npc-logout-cli.ts
scripts/npc-chat-cli.ts
scripts/npc-session-cli.ts
scripts/npc-serve-cli.ts
package.json
tests/codex-profile.test.ts
tests/codex-persistent-auth.test.ts
tests/codex-logout-cli.test.ts
tests/codex-isolation.test.ts
tests/codex-policy.test.ts
tests/codex-bridge.test.ts
tests/codex-auth.test.ts
tests/fixtures/codex-server.mjs
README.md
docs/codex-authentication.md
docs/manual-chat-batch.md
docs/manual-chat-session.md
docs/obs-presentation.md

Use only needed surfaces. package.json changes only add the logout script, no dependency/lockfile changes. Existing product entrypoints only opt into persistent startup. schema.ts changes only add scoped persistence/logout checks where grounded by the pinned protocol without weakening existing checks. Source model/provider/approval logic, Rpc transport, UI/pacing/publisher/server/personality and all other files are frozen. Parent owns this document and its full Engram mirror.

## Tasks

- [x] T1 Diagnose ephemeral sign-in and validate the scoped persistence design.
- [x] T2 Implement persistent profile/startup/logout with behavioral RED, GREEN and triangulation.
- [x] T3 Independently verify required safety properties, perform applicable native review and hand off human restart/logout testing.
- [ ] H1 Human acceptance: first login, normal restart reuse, concurrent rejection, explicit logout/relogin and native cleanup.

## Verification

Strict TDD ON from AGENTS.md. Use installed Node 22/npm via .local/toolchains/run-npm and pinned Vitest. Baseline 386 tests in sixteen files. Missing imports/config failures do not count as RED. Test fake temporary metadata/files, root resolution independent of sanitized HOME, symlink/hardlink/ownership/mode rejection without reading secret data, no automatic repair, file-mode-only config delta, unchanged ephemeral sandbox defaults, early conflict/error ordering, close/cancel and child exit ownership, two distinct child lifetimes reusing synthetic state, existing-account skip and missing-account ceremony, logout wire omission, no login/inference on logout, invalid/help/unconfirmed/TTY gates, safe diagnostics and cancellation. Do not confuse fake RPC state reuse with actual two-process storage coverage.

Required commands, foreground and exact results:

```sh
.local/toolchains/run-npm test -- --run tests/codex-profile.test.ts tests/codex-persistent-auth.test.ts tests/codex-logout-cli.test.ts tests/codex-isolation.test.ts tests/codex-policy.test.ts tests/codex-bridge.test.ts tests/codex-auth.test.ts tests/codex-chat-cli.test.ts tests/codex-session-cli.test.ts tests/codex-serve-cli.test.ts
.local/toolchains/run-npm test -- --run
.local/toolchains/run-npm run typecheck
.local/toolchains/run-npm run npc:chat -- --help
.local/toolchains/run-npm run npc:session -- --help
.local/toolchains/run-npm run npc:serve -- --help
.local/toolchains/run-npm run npc:logout -- --help
git diff --check
git status --short
```

Direct whitespace checks must include changed untracked files. Capture public before/after hashes and protected-file comparison, excluding real profiles/credentials and ignored machine data. Prior reviewed tree 2c8c887abe75fa62d965f68a039ccd458b0241f8 differs by the administrative overlay-message-bubbles tracker closure and this new parent tracker before implementation. The approximately 400-line heuristic is advisory: keep coherent security/lifecycle tests and docs, no minification or artificial splitting.

No agent may run real npc:* startup/logout, Codex, schema generation, native isolation probes, principal-profile checks, or use actual auth data in tests. Temporary fake-child flock tests must have bounded deadlines and deterministic process cleanup. Stop and report if required lifecycle guarantees cannot be achieved within this scope.

## Pending human acceptance

After technical approval, the user must verify first login, normal close/restart without ceremony, explicit logout followed by login, simultaneous-process rejection and real cleanup in their environment. Native source inspection and synthetic tests are not this runtime evidence. Session revocation, failed refresh, or damaged native auth storage can still require user intervention; persistence is not a promise of permanent access. Existing local schema prerequisites may require the user to run the documented isolated preparation themselves. Do not run it automatically.

## Initial independent verification and bounded correction (historical)

Initial writer mu9puvex-7-rm6b reported 26 behavioral RED failures and GREEN of 194 focused / 425 full tests in nineteen files. Historical RED is writer-attributed. Parent inspected three implementation files and reran the three new suites: 35 passed. Native ASSESS returned unassessable, requiring independent verification. No native review has started for this candidate.

Read-only verifier mu9qe9nk-8-ya2t independently ran the ten-file focused suite (194), full suite (425), typecheck, four helps, Git and direct whitespace checks successfully, but returned FAIL with these confirmed findings:

1. prepareProfile mutates before rejecting unsafe existing state. With an absent lock, unsafe auth mode 0644, symlink/hardlink/directory auth or a regular-file home creates codex.lock before failure. A pre-existing ancestor symlink above an explicit XDG root redirects creation of app/home/lock into a temporary fake repository, then the late canonical check rejects. This is deterministic, not a malicious same-UID race.
2. assertLogoutResult accepts null and arbitrary objects. Actual fake-wire null and {success:false}, and direct {error:"NONSECRET"}, produced exit 0 and loggedOut:true. The pinned response contract is an empty object. Wire errors, missing result and arrays failed safely.
3. An actual held flock yielded seven profile_busy and three transport_error results in ten openPersistent attempts. Initialization stdin error can precede child close; the catch removes the conflict observer before awaiting close and loses exit 100. Kernel exclusion itself held.
4. Static comparison also found the persistent sandbox omits the baseline /bin/bwrap read-only bind. Restore this baseline constraint; native consequence has not been tested.

Kernel probes using only installed flock and fake Node children passed conflict exit 100, stable lock inode, cross-process NONSECRET disk reuse and reacquisition after normal/error/SIGTERM/SIGKILL child exits. Synthetic UID mismatch rejected successfully. Pending-start/logout cancellation suppressed success; a signal during cleanup after already-confirmed logout was not uncertain success. These probes are not persisted regression tests or native bwrap/Codex proof.

Verifier scope: exactly 21 allowed writer paths plus two known administrative exceptions; 49 protected public files matched the prior tree. Its 75-file before/after manifests were identical, b7d37d667727edcd91f43aa276e7ca6072f94729cc305e9012e501a861bc6773. Protected manifest: a3c1e6010b976e948c186e9ebb232439fa7c02f6f991157c26cf0342d9a21e46. No real profiles or credentials were accessed; temporary files/processes were cleaned.

T2 remained unaccepted at that stage. The authorized correction was limited to src/codex/{profile,policy,bridge,isolation}.ts and tests/codex-{profile,persistent-auth,logout-cli,policy,isolation}.test.ts, plus docs/codex-authentication.md only for directly related accuracy. No other edit surfaces for this correction. Require behavioral RED for the three findings and baseline-bind regression before fixes. Validate all existing relevant metadata and canonical ancestry/containment before the first mutation; preserve no-repair/no-token-read behavior. Require precisely the pinned empty-object logout success, with no relaxation to null or arbitrary objects. Retain pre-handshake conflict observation through cleanup/close settlement and always dispose listeners; successful handshake ends conflict classification. Preserve the existing Rpc transport.

Persist meaningful kernel flock/two-process disk reuse, UID mismatch, startup/logout/cleanup cancellation and production startPersistent composition checks using safe temporary fixtures and injected native boundaries only. No real runtime probes. Missing-import failures do not count as RED, and mock account reuse alone does not prove disk persistence. Do not change the confirmed-cleanup signal semantics merely to add a test. Run all previously required commands again, compare protected writer-start/end bytes, then obtain fresh independent verification. Keep tracker and mirror parent-owned. The human account test remained paused during those corrections.

## Technical completion; human acceptance pending

Independent verifier mu9tbf7z-e-lkw0 returned PASS after the production and test-harness corrections. It independently ran the exact focused command above (227 tests in ten files), full command (458 tests in nineteen files), typecheck, all four help commands, Git checks and direct whitespace checks across 53 changed tracked/untracked paths, including all nine task documents. Earlier blocked runs were not counted as passes. Historical RED remains attributed to its writer; intermediate fixture/disposal toggles were controlled mutation evidence, not independently established baseline RED.

Independent probes closed all demonstrated counterexamples: eight unsafe-profile fixtures rejected without mutation; synthetic error-before-close and cleanup exceptions preserved ownership and evidence; ten actual held-flock attempts all returned profile_busy with child exit 100; seven real Node fake-wire logout cases accepted only the empty-object success with omitted params and fixed error projection. Twenty-eight owned fake children were observed closed. Normal EOF, child error, SIGTERM and SIGKILL permitted distinct replacement children to reuse NONSECRET disk state and the same lock inode. In-memory schema fixtures prevented reads of the local generated-schema cache. These are bounded synthetic checks, not real authentication or bwrap evidence.

Native review review-f144d8141a20cbd4 covered 53 paths, four lenses and 8,118 original changed lines. It opened one bounded correction for R3-profile-test-isolation: tests could inherit XDG_STATE_HOME despite a temporary accountHome. The documented npm wrapper uses env -i and excludes that variable; this finding is not evidence that prior wrapper-based checks overwrote real credentials. The correction changed only tests/codex-profile.test.ts and tests/codex-persistent-auth.test.ts: explicit fixture roots, containment assertions before mutation and inherited external NONSECRET-state regressions. Parent independently counted +95/-21 = 116 diff lines against the frozen tree, within the accepted 160-diff-line plan; the separate frozen logical budget was 200. All 73 other public files matched the pre-correction manifest.

The final writer reported 229 focused and 460 full tests. Parent independently reran `.local/toolchains/run-npm test -- --run` (460 passed in nineteen files) and `.local/toolchains/run-npm run typecheck` (exit 0). Native targeted validation approved the correction; parent acknowledged approval and the authority was burned. A subsequent assessment explicitly recorded nativeReviewOutcome=closed and required no further separate verifier: writer self-verification plus the closed native review was the returned plan.

- Approved implementation tree: 7daa38fcef14c3772feea96cd3ce9474d2f942de.
- Approved target: sha256:32ba1f2e011895e0baf0fc6332f4270bf62bf52674d7ee34b10330b8c6984b47.
- Consumed revision: sha256:3d4d2825bdd9514f29d12319851d6347681a8bb7e4e39de8b5922878b772a678.
- Final pre-closure 75-file manifest: 46dc8093825966a29dde5545952f8e6945239412b80443054d751de226132fbf.
- Protected 73-file manifest, excluding the two correction tests: 05c77c26ff41d5591fd735969f5a373369c7fa5f371fe8534da40ba3bc3552a8.

Manifest encoding is UTF-8 compact sorted JSON mapping public, nonignored paths to SHA-256 file hashes, then SHA-256 of those JSON bytes. Exact scope of the final test-only rounds was independently established. The earlier ten-path correction-history limitation remains: aggregate manifests alone did not reconstruct every intermediate per-file change. No out-of-scope current-candidate difference was found.

Seven native informational advisories remain separate later work: R2-divergent-profile-diagnostics, R2-incomplete-snapshot-count, R3-busy-diagnostic, R3-late-abort, R3-stdout-error, R4-profile-diagnostics-hidden and R4-stdout-error. None reopened the approved review or authorized further edits. A busy product startup may project a generic startup error rather than the bridge's detailed busy code.

This task-document update is administrative closure after approval; it does not claim that its new text was part of the reviewed implementation tree. No staging, Git commits, remotes or global settings were changed. The two writer-declared temporary diagnostic logs were removed after metadata checks without reading their contents.

The next step is human-only acceptance using the product command: first managed login, normal /exit, reopen without another ceremony, concurrent-process rejection, then explicit logout after closing other instances and subsequent login. Never share login codes, tokens or authentication files. Actual managed refresh, remote revocation and native sandbox cleanup remain unproven until separately exercised; approval does not establish permanent access or crash-proof credentials.
