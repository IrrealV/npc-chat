# Continuous manual chat session

## Objective and authorization

The user approved a persistent, human-operated terminal session: one ephemeral login, several manually entered events, bounded context and returning fictional participants. Preserve `npc:chat`. No autonomous generation, real agent-run authentication/inference, microphone, OBS, capture or UI.

## Allowed implementation surfaces

- `src/npc/chat.ts`: additive contextual request/validation support; preserve context-free behavior and prompt bytes.
- `src/npc/session.ts`: new bounded in-memory session state.
- `src/npc/session-cli.ts`: new orchestration and testable terminal-input adapter.
- `scripts/npc-session-cli.ts`: new executable wiring.
- `tests/codex-session.test.ts`: new session behavior tests.
- `tests/codex-session-cli.test.ts`: new CLI/input tests.
- `package.json`: add `npc:session` only.
- `tsconfig.json`: add NPC source/entrypoint includes only.
- `README.md`: short command/link addition.
- `docs/manual-chat-session.md`: new zsh-compatible human guide.

Parent owns this document. Preserve all earlier uncommitted work. No changes to existing Codex modules, one-shot CLI/scripts/tests, fixtures, lockfile or dependencies. No installs, native Codex/protocol/isolation probes, credentials access, global configuration, review-tool synchronization, staging, commits or push. Existing ignored test/cache outputs are allowed.

## Contract and defaults

- Separate `npc:session [--count N]` command; default five, integer 2–10. Strict parsing; `--help` alone needs no TTY/startup. Actual use requires interactive stdin and stderr.
- Login once per process. Await one event and one generation at a time. Blank input does nothing; `/exit` or EOF exits normally while idle. EOF during generation allows that accepted turn to settle, then exits. `Ctrl+C`/SIGTERM interrupts and ends the session, including during login/input/cleanup. Do not implement `/cancel`-and-resume.
- Discard complete lines received while busy; never queue pasted/stale events. A sequential read loop alone does not prove this: test the real input adapter. Close the input source and unregister readline/process listeners on every terminal path; cover readline SIGINT as well as process signals.
- Context lives only in application memory: the bridge starts a fresh provider thread per call. Store at most three completed, validated prior turns (event plus messages), with defensive copies. No raw failed output or credentials in state.
- Build a fully escaped prompt at most 4,000 characters. Current event has precedence. Evict whole oldest turns deterministically until the prompt fits; never truncate the current event or silently enlarge limits. If no history fits, proceed context-free and do not require returning participants. An event that cannot fit alone is rejected before inference.
- Derive the bounded roster solely from history actually included in the prompt. When nonempty, require at least one matching returned username using existing trimmed/case-insensitive identity semantics. New participants remain allowed; no repair/retry. Do not fix the earlier Unicode advisory in this batch.
- Use shared prompt/response validation rather than duplicate parsers. Context-free behavior and existing one-shot output remain unchanged. Invalid input before inference leaves state unchanged and may re-prompt; any failed generation/authentication ends the session without automatic retry/relogin because bridge errors may close its transport.
- One JSON batch line per validated successful turn; prompts and safe diagnostics on stderr. Never publish partial/cancelled results, echo raw errors/events/account data, render model text as terminal controls, or capture the login ceremony. Already-published turns remain published if a later turn fails.

## Tasks and verification

- [x] T1 Map code and reconcile source evidence.
- [x] T2 Define scope and safe defaults.
- [x] T3 Implement with behavioral RED, GREEN and triangulation; both verification findings corrected.
- [x] T4 Complete required fallback verification, spot-check and handoff; native review unavailable, not approved.

TDD ON from `AGENTS.md` and `.pi/skills/electron-testing/SKILL.md`. Pinned Vitest through local Node 22.23.2/npm 10.9.8; missing-import failures alone are not RED. Required commands:

- `.local/toolchains/run-npm test -- --run tests/codex-session.test.ts tests/codex-session-cli.test.ts tests/codex-chat.test.ts tests/codex-chat-cli.test.ts`
- `.local/toolchains/run-npm test -- --run`
- `.local/toolchains/run-npm run typecheck`
- `.local/toolchains/run-npm run npc:session -- --help`
- `.local/toolchains/run-npm run npc:chat -- --help`
- `git diff --check`
- `git status --short`

Test three related events, one login, sequential calls, returning-name enforcement, escaped budget/whole-turn eviction, bounded immutable history, failure/no state update, busy-input dropping, EOF/exit, cancellation races and cleanup. Exercise actual entrypoint help/invalid args without Codex. Hash protected surfaces before/after. About 400 changed lines is advisory, not a cap; preserve readable implementation and necessary tests.

## Evidence and next step

At T1, parent observed the expected prior dirty paths on `main`, before session implementation. The baseline was 265 tests, not new-batch evidence. Source readback confirms fresh provider threads and terminal bridge failure semantics. Imported NPC modules already receive typechecking through tests; the entry scripts lack explicit includes, which this batch adds. Scout suggestions that abort could resume the same bridge or sequential reads prevent buffering were rejected.

T3 writer completed the ten authorized implementation paths. Writer-attributed RED: 25 behavioral failures and 66 passes, plus a stub-related unhandled rejection. Final GREEN: 94 focused tests across four files, 296 total across ten files, typecheck and both help commands passed. Typecheck initially caught three new defects that were corrected. Protected hashes were unchanged; no native/provider actions occurred.

Native assessment is unavailable/empty and requires independent verification. T4 verification settled PARTIAL despite 94 focused/296 full tests, typecheck and both helps passing. A high finding reproduces cancelled-history commit with actual `CodexBridge.text/runTurn` over fake RPC: completion notification, then abort before the start response resolves. The CLI stdout guard does not protect public state. A low finding identifies a missing-returner test masked by two returned messages versus default count five. Protected hashes and real input-adapter synthetic checks passed.

The two-file correction added a post-await abort boundary before history mutation and repaired the test's count precondition. Writer-attributed RED: three cancellation-race failures with 94 passes; GREEN: 97 focused and 299 full tests. The low test correction was not claimed as production RED.

Independent re-verification closed PASS: both findings resolved; the original real-bridge/fake-RPC race now rejects with `aborted`. A caught-rejection variant proved empty/prior history preservation, one cancelled call, no listener leak, overlap rejection and guard release without retry. All required commands passed: 97 focused tests, 299 across ten files, typecheck, both help commands and Git checks. Parent repeated both help commands and whitespace checks successfully.

Evidence limits: RED and the writer's first-eight pre/post correction hash equalities remain writer-attributed; independent earlier hashes were unavailable for those eight files. Lockfile comparison and unchanged tracked Codex modules/legacy CLI versus HEAD were independently supported. Real TTY/OS signals and provider behavior remain untested for this session feature.

Final native inspection selected all 19 intended changed paths and stopped at `managed_assets_outdated`. No session review lineage was started and no native approval exists. No tool synchronization or settings changes were performed. Assessment with `nativeReviewOutcome: unavailable` required the high-risk fallback of writer self-verification plus independent verification; both are complete, including corrected-behavior re-verification and parent spot checks.

The prepared command is `.local/toolchains/run-npm run --silent npc:session -- --count 5` from the repository root, with terminal stdin/stderr. Follow `docs/manual-chat-session.md`; enter one event per ready prompt and never share the device code. Human real-session evaluation is still separate and pending. Stop here: no next batch, automatic provider execution, global maintenance, staging, commit or push is authorized by this handoff.
