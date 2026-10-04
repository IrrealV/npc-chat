# Manual event to simulated chat batch

## Objective and rationale

Build the first bounded step toward a simulated spectator chat: one manually supplied streamer event produces one model generation containing messages from multiple fictional usernames. Validate the batch as untrusted data before exposing it to future views. This is a library-level proof with synthetic tests, not an authenticated demonstration or a complete MVP.

The full product direction is microphone plus OBS program imagery as input, and one conversation shared by an OBS reading dock and public overlay. Visual perception must ignore real and simulated chat. Those integrations are outside this batch. Real-platform connectors and NaN remain deferred.

## Authorization and scope

The user authorized starting work after confirming the product direction, then explicitly approved an isolated repository-local Node 22.23.2 / npm 10.9.8 runtime to install dependencies and run TDD. No global configuration, persistent PATH, authentication, trust, routing, or permissions may change.

This batch permits local dependency preparation, synthetic tests/typechecking, the batch adapter and its documentation. No login, real inference, native Codex readiness/protocol probes, audio/vision capture, OBS configuration, UI, platform connectors, new provider, credentials access, staging, commits, push or deployment.

### Allowed implementation surfaces

- `src/npc/chat.ts` (new)
- `tests/codex-chat.test.ts` (new; matches the existing Vitest include glob)
- `tests/fixtures/codex-server.mjs` (add bounded synthetic modes only)
- `docs/manual-chat-batch.md` (new)
- `README.md` (small link and current-scope note)

The parent owns this task document. Existing Codex production modules, CLI, package manifests, lockfile, test configuration and legacy behavior remain unchanged.

### Authorized ignored setup and runner outputs

- `.local/toolchains/`: isolated versioned runtimes, bounded download/integrity metadata, empty runtime HOME, and a local `run-npm` wrapper.
- `.local/batch1/npm-globalrc`: empty separate npm global configuration.
- `.local/batch1/npm-cache/`: local npm cache.
- `node_modules/`: lockfile-based dependencies and ordinary Vitest temporary/cache output.

Do not overwrite any pre-existing toolchain or local configuration without inspecting its non-secret identity and reporting a conflict. Never read personal npm/authentication configuration.

## Behavior contract

- Manual event supplied through a typed function argument; no new authenticated CLI in this batch.
- One `CodexBridge.text()` call per batch, not per fictional participant.
- Default five messages; a configurable count, if exposed, is a bounded integer from 2 to 10. Returned length must equal the requested count.
- Each message is exactly `{ username: string, message: string }`. Emojis are part of the message string, not a separate field.
- At least two distinct usernames after trimming and case-insensitive comparison. Repeated usernames are allowed for conversation between participants.
- Usernames are nonblank and at most 32 Unicode code points; message text is nonblank and at most 200 Unicode code points. Treat all accepted strings as plain text, never executable markup.
- Reject malformed JSON, non-array roots, wrong keys/types/counts, invalid bounds and single-user batches. Do not repair output, invent fallback messages or retry inference.
- Bound and validate event input before calling the bridge; ensure the complete prompt respects its existing 4000-character limit, including escaping and instructions.
- Frame the supplied event as data; request varied, short Spanish messages from fictional viewers. Naturalness, irony and relevance are prompt goals, not guarantees from shape validation.
- Forward cancellation; do not publish interrupted or partial generations even if their text happens to parse.
- Return existing model/version/status/timing provenance without presenting synthetic fixture timings as provider performance.
- Preserve all account, quota, model-selection, tool-denial, isolation, timeout and transport-fault behavior below the adapter.

## TDD mode and verification

TDD is ON, sourced from `AGENTS.md` Evidence and hygiene and `.pi/skills/electron-testing/SKILL.md`. Runner: the repository's pinned Vitest via the isolated local Node/npm wrapper. Observe behavioral RED before production implementation, then GREEN, alternate/negative cases and refactor evidence. Missing imports or an undiscovered test file alone are not sufficient behavioral RED.

Commands after runtime preparation:

- `.local/toolchains/run-npm --version`
- `.local/toolchains/run-npm ci --ignore-scripts --no-audit --no-fund`
- `.local/toolchains/run-npm test -- --run tests/codex-chat.test.ts` (focused TDD)
- `.local/toolchains/run-npm test -- --run` (baseline and final synthetic regression)
- `.local/toolchains/run-npm run typecheck`
- `git diff --check`
- `git status --short`

The wrapper must use only local versioned Node/npm, a cleared environment, local HOME/cache, `/dev/null` user config and the empty separate local global config. It must not load personal npm settings. Dependency lifecycle scripts stay disabled during installation.

Synthetic runtime harness: the focused chat test runs the actual bridge/RPC against the owned Node fixture, not Codex. Verify exactly one turn per batch, quota check before turn, bounded structured output and cleanup. Real authenticated quality, latency, entitlement, desktop, OBS and multimedia remain untested.

## Tasks and acceptance

- [x] T1 Map the smallest change and inspect the existing transport/test contract.
- [x] T2 Prepare and integrity-check the explicitly authorized local runtime; install from the unchanged lockfile.
- [x] T3 Record baseline full synthetic suite and typecheck on the supported runtime.
- [x] T4 Implement the adapter, focused negative/boundary tests, owned-fixture integration and documentation with observed behavioral RED/GREEN.
- [x] T5 Complete final synthetic regression/typecheck, required independent/native review path and parent spot check; reconcile this document and Engram.

Acceptance: valid batches preserve requested count, multiple fictional usernames, Unicode/emoji text and provenance; invalid inputs fail before inference, invalid/interrupted output never becomes a successful batch, no retry is introduced, one-turn/quota ordering is evidenced by fixture integration, and legacy tests/production files stay intact. Evidence must identify failures and limitations rather than substituting history for current results.

## Progress and evidence

- Starting repository: clean `main` at `84a8d83`.
- Initial inspection: Node `v26.8.2`, npm `11.19.1`, no `node_modules`.
- A separate read-only diagnostic found no compatible Node 22 in the authorized standard installation locations. It found an unrelated Node 25 installation; no environment changes or downloads were made.
- User approved repository-local runtime preparation. Default Node 26 must not be used to bypass the package engine constraint.
- Mapping found the existing bridge already accepts arbitrary bounded text and exposes provenance. Parent readback caught that `tests/npc-generation.test.ts` would NOT match `tests/codex-*.test.ts`; the authorized filename is `tests/codex-chat.test.ts`.
- Setup writer completed the official Node 22.23.2 download and safe extraction; bundled npm is exactly 10.9.8. Archive SHA256 `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307` matched official release metadata. All 5,866 archive member/link paths were checked before extraction.
- `.local/toolchains/run-npm ci --ignore-scripts --no-audit --no-fund`: passed, 48 locked packages installed. The wrapper clears inherited environment and uses local HOME/TMPDIR/cache and separate empty npm configuration.
- `.local/toolchains/run-npm test -- --run`: setup writer observed 202 passing tests in six files. `.local/toolchains/run-npm run typecheck`: passed. These are baseline results, not new adapter TDD evidence.
- Parent reran both version commands and inspected the wrapper. `package.json` SHA256 remains `53980dfde5e1b12eb002c23b2b3ed83ccb9d428cfc01bd4bc8dcc2817b3c735b`; lockfile remains `9bf12019f751e460ff087b078ec44d35f0de9377faed81007928d5ccb8b64ffb`.
- Setup writer `git diff --check` passed; status contains only the parent-owned untracked `odd/`. Runtime/dependency paths are ignored.
- Native assessment of the setup writer returned unavailable/empty output and required independent verification. The scoped verifier independently passed Node/npm versions, archive and manifest hashes, all 202 tests in six files, typecheck and Git checks. It inspected the wrapper's cleared environment and isolated configuration. No blockers; ignored installation history was not independently audited.
- T4 writer implemented the adapter and five authorized feature paths. Writer-attributed behavioral RED: 31 failures from a non-working typed scaffold; GREEN: 31 focused tests. Full synthetic suite: 233 tests across seven files; typecheck passed. Parent repeated the focused command successfully.
- First independent feature verification passed all commands but found two medium gaps: four malformed-item cases rejected at count validation instead of item validation, and the API example omitted its authenticated same-process prerequisite and referenced an undefined controller.
- Scoped correction touched only the new test file and usage guide. Writer-attributed test-precondition RED: four failures/27 passes from two items versus requested count five; GREEN: all 31 focused tests after matching counts. Full suite 233/7 and typecheck passed. This RED is test-data evidence, not a production defect.
- The guide now receives an already-authenticated same-process bridge, defines the controller and documents caller-owned cleanup. No example/login was executed. Parent read both corrections and repeated the focused 31-test command successfully.
- Adapter, fixture, README and both manifests retained identical correction before/after hashes. Adapter SHA256 is `f10cd48863c8ae249b92eb252814a8b56bd77d386501ccf1ac9b967d2dd37567`.
- Independent correction verification closed PASS: both findings resolved, 31 focused tests, 233 full tests across seven files, typecheck, Git checks and all five supplied hashes passed. No new local issues. RED remains writer-attributed; documentation was not executed and ignored runner outputs were not independently inventoried.
- Native ordinary review included all six candidate paths, including the four explicitly selected new files. All four reviewer lenses were admitted; the candidate was approved and exactly acknowledged. No native correction was required. One informational, non-blocking Unicode-identity advisory remains deferred, not authorization for further changes.
- Native assessment remained unavailable, but post-acknowledgement assessment recognized the closed review and required no additional verifier for that reviewed candidate. Independent synthetic verification had already passed.
- This final tracker closure is administrative and later than the exact reviewed snapshot; the native approval must not be represented as covering this later tracker text. Feature code/tests/usage documentation remain unchanged.
- No authentication, inference or native Codex probes have run.

## Review and rollback boundary

Aim for one coherent reviewable adapter with its tests/docs; roughly 400 authored changed lines is a planning heuristic, not a cap. Do not omit tests, minify or split artificially.

Rollback, if separately authorized: remove only this batch's new adapter/test/docs and reverse its fixture/README edits, preserving all unrelated work. Local runtime/dependency artifacts are separate ignored setup state. No rollback, staging or delivery is authorized automatically.

## Next step

This bounded batch is complete. Stop and hand off the library proof and synthetic evidence. Real-provider JSON compliance, chat quality and latency still need a separately authorized human-run trial; microphone/OBS/UI work is not started. No staging, commit, push, live authentication or next batch is authorized by this closure.
