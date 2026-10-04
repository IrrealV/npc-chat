# Human-operated manual chat CLI

## Objective and authorization

Prepare a terminal command so the user can supply an event, perform managed ChatGPT sign-in and inspect one validated multi-user chat batch. The user authorized preparation and execution instructions after the library batch; the agent will implement and test synthetically, not perform real sign-in or inference.

One command must own startup, ephemeral authentication, generation and cleanup. A separate login command cannot authenticate a later process. Do not invoke the legacy smoke command, which also probes Live.

## Scope

One scoped writer may edit only:

- `scripts/npc-chat-cli.ts` (new thin executable)
- `src/npc/chat-cli.ts` (new testable orchestration)
- `src/npc/chat.ts` (only extract/reuse existing pure input validation and prompt preparation; preserve behavior)
- `tests/codex-chat-cli.test.ts` (new; discovered by existing Vitest glob)
- `package.json` (add `npc:chat` script only)
- `README.md` (short usage/link update)
- `docs/manual-chat-batch.md` (human execution guide)

The parent owns this document. Preserve all earlier uncommitted work, including fixture/tests and the previous task document. No existing Codex production module, legacy CLI, dependency/version, lockfile or test configuration changes. No installs, credential inspection, real Codex/protocol/isolation probes, auth/inference, global settings, UI, OBS, audio, provider changes, commits or push. Runtime test/cache outputs under existing ignored local paths are allowed.

## Behavioral contract

- Entry: `.local/toolchains/run-npm run npc:chat -- --event "..." [--count N]`; portable npm equivalent with the required Node version documented.
- `--help` alone succeeds without runtime startup or a TTY. Reject unknown/duplicate options, positional arguments and missing values. Define mixed help/options explicitly rather than silently ignoring invalid options.
- Missing/blank event, invalid count and oversized fully escaped prompt fail before any startup/authentication. Reuse the adapter's exact validation through a small pure helper; do not approximate or duplicate its bounds.
- Interactive stderr is required for actual execution. Ceremony URL/code go only to the user's terminal stderr, never JSON, logs or files. Do not echo event, account identifiers, raw responses or error messages/causes in diagnostics.
- Start one bridge, perform its managed login in that process, call the existing batch adapter once. Do not call Live, retry inference or switch providers/models/policy.
- Successful stdout is a JSON record containing validated messages and model/status/timing provenance. JSON encoding keeps model strings as plain data. Startup/auth timing may be included, but no raw event or account dump is necessary.
- Map adapter errors and bridge errors to bounded plain-data error codes. Unknown errors must not expose their messages. Set nonzero exit status on errors/interruption; no successful batch on failure.
- Forward SIGINT/SIGTERM via AbortSignal to text generation. During login, abort alone is insufficient because `CodexBridge.login` has no signal argument: close its transport so pending authentication stops. Handle cancellation during pending startup, suppress ceremony after cancellation, check cancellation between phases, always close owned resources and remove listeners. Do not assert remote cancellation acknowledgement without evidence.
- Keep timeout/quota/model/tool-denial/isolation behavior in the existing bridge unchanged.

## TDD and verification

TDD ON, sourced from `AGENTS.md` and `.pi/skills/electron-testing/SKILL.md`. Use pinned Vitest through the existing isolated Node 22.23.2/npm 10.9.8 wrapper. Observe behavioral RED, then GREEN and alternate/negative cases; missing-module failures alone do not count.

Required writer commands:

- `.local/toolchains/run-npm test -- --run tests/codex-chat-cli.test.ts tests/codex-chat.test.ts`
- `.local/toolchains/run-npm test -- --run`
- `.local/toolchains/run-npm run typecheck`
- `.local/toolchains/run-npm run npc:chat -- --help`
- `git diff --check`
- `git status --short`

Use synthetic bridge seams to exercise parsing, early validation including escaped prompt overflow, TTY gating, exact one-call lifecycle, safe output/error projection, login failure, cancellation at each phase and cleanup. Include executable wiring evidence for help and invalid arguments without spawning Codex. Never mistake faked authentication for a provider test. Parent repeats a bounded command; risk assessment and applicable independent/native review follow the completed candidate.

## Tasks

- [x] T1 Map the smallest CLI, existing lifecycle and prerequisites.
- [x] T2 Record exact scope, safety boundaries and acceptance criteria.
- [x] T3 Implement CLI, tests and guide with RED/GREEN evidence; verified cleanup cancellation and prerequisite-order defects corrected.
- [x] T4 Complete required fallback verification and hand off exact human-run instructions; native review is unavailable, not approved.

## Evidence and limitations

- Starting state: `main` at `84a8d83` plus the completed earlier library batch's uncommitted six paths. Preserve those changes.
- Parent observed local Node `v22.23.2`, npm `10.9.8`, and a `bwrap` executable. This does not prove namespace capability or native readiness.
- Previous library batch independently passed 233 tests in seven files and typecheck; those are historical results until rerun for this candidate.
- Read-only mapping identified the new entry/orchestration/test paths and existing `codex:protocol` / `codex:check-isolation` commands. Current generated-schema presence and current native isolation execution remain unverified. Ignored paths are inspectable with explicit filesystem metadata; a glob hiding them does not establish absence.
- Parent readback corrected the mapper's signal premise: `login` has no AbortSignal parameter, so cancellation must release the transport, as the existing CLI does. No bridge changes are authorized.
- Existing generated schemas, pinned binary usability, current network/entitlement, JSON compliance, quality and latency are not proven by synthetic checks. The guide must separate human prerequisite commands from commands actually executed here and must not claim historical isolation results as current passes.

- T3 writer reported 30 behavioral RED failures against a typed stub while 31 existing adapter tests passed. GREEN: 61 focused tests across two files; full suite 263 tests across eight files; typecheck, executable help and Git checks passed. These RED results remain writer-attributed.
- Writer added the seven scoped paths/changes and reported unchanged lockfile, old CLI, fixture, old adapter tests and all Codex source hashes. No real/native probes occurred.
- Native assessment returned unavailable/empty output and an unassessable risk tier, requiring an independent verifier. The verifier reproduced all 61 focused/263 full tests, typecheck, help and integrity checks, but returned PARTIAL with two medium findings: a signal during successful asynchronous cleanup still published a batch; the guide checked generated schemas before generation. Binary metadata exists; both checked generated schemas are absent. No native command ran.
- Scoped correction changed only CLI orchestration, CLI tests and guide. Writer-attributed behavioral RED: one cleanup-cancellation failure and 62 passes; GREEN: 63 focused and 265 full tests. It added repeated-signal/deferred-cleanup coverage, reordered prerequisites and covered raw-short escaped-only overflow.
- Independent re-verification closed PASS: both findings resolved, the original fake-bridge reproduction now returns exit 1/no stdout/interrupted/listener removed, 63 focused and 265 full tests across eight files passed, typecheck/help/Git checks passed, and five protected hashes matched. Parent read the changes and repeated executable help plus whitespace checks successfully.
- Entry-script typechecking remains limited by the existing tsconfig include; executable help and invalid-argument tests run the actual entry. RED is writer-attributed. Native protocol/isolation, authentication and inference remain unexecuted.
- Final native inspection included all eleven intended paths but stopped at `managed_assets_outdated`, requiring tool synchronization. No CLI review lineage was started and no native approval exists. Tool synchronization/global configuration changes were not authorized or performed.
- Assessment with the explicit unavailable native-review outcome returned the high-risk fallback: writer self-verification plus independent verification. Both are complete, including the independent correction recheck and parent help/whitespace spot check. This fallback completes the verification handoff, not the unavailable native review.

## Next step

The command is prepared and independently verified with synthetic evidence. Follow `docs/manual-chat-batch.md` from the repository root: generate the pinned protocol, confirm generated files, check isolation, then run `npc:chat` interactively. Stop on any failure; never capture or share the terminal sign-in ceremony. Real-provider behavior remains unverified until the human trial. Native review/tool maintenance remains a separate unavailable item, not an approval. No next batch, global maintenance, native execution by the agent, staging, commit or push is authorized by this handoff.
