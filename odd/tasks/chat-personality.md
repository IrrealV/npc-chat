# Believable chat voices and persistent personalities

## Objective and authorization

The user approved the Spain-colleagues profile after rejecting real session output as generic and uncanny: identical polished jokes, frequent emojis, narrator language and synchronized assistant-like apologies. Improve shared style and distinct recurring voices without changing the provider or chat transport. Human taste, not passing tests, determines realism.

## Allowed surfaces

- `src/npc/personality.ts` (new bounded profile definitions/helpers)
- `src/npc/chat.ts` (shared style and additive persona-aware request preparation)
- `src/npc/session.ts` (bounded identity/profile state and matching preflight)
- `src/npc/session-cli.ts` (only delegate event preflight to the session's persona-aware preparation)
- `tests/codex-personality.test.ts` (new behavior tests)
- `tests/codex-chat.test.ts` (prompt/budget expectations only, preserve existing guards)
- `tests/codex-session.test.ts` (prompt/budget expectations and persona invariants; preserve lifecycle regressions)
- `docs/manual-chat-batch.md`
- `docs/manual-chat-session.md`

Parent owns this tracker. Preserve earlier uncommitted batches. No changes to Codex modules, entry scripts, CLI lifecycle/input adapter, existing CLI tests, fixture, package/lockfile, compiler/test configuration or dependencies. No installs, native probes, authentication/inference by the agent, credentials access, OBS/audio/UI, global settings/tool synchronization, staging, commits or push. Ordinary ignored test/cache outputs are allowed.

## Contract

- Shared style: casual Spanish from Spain, varied fragments/laughter/direct conversation, plausible mixed nicknames, occasional sincere support and teasing of actions. Avoid narrator descriptions, forced metaphor/punchline/emoji on every line, synchronized voices and assistant-like apologies. Do not force misspellings, catchphrases or insults. Respect requests to ease off without making everyone adopt the same voice.
- First appearances receive shared-style guidance. After a validated, non-cancelled turn, assign newly observed normalized identities stable compact profiles from a fixed complementary pool, in deterministic first-seen order, up to eight identities. Never rotate/evict existing associations during the process. Extra identities remain allowed under shared style, without individual profiles. One-shot calls have shared style but no cross-call persona persistence.
- Keep persona state independent of the three-turn history window. Include all stored compact profiles even when conversation history is evicted; do not claim persistence while dropping every profile from the prompt. Names are escaped data. Profile definitions contain no invented biography or memories.
- Keep the 4,000-character fully escaped prompt ceiling. Shared instructions and stored profiles are fixed overhead; evict only whole oldest history turns. Never truncate the current event. If event plus fixed overhead cannot fit, reject locally before inference. Document the reduced event/history capacity rather than silently relaxing bounds or losing identities.
- Use additive explicit persona inputs in shared request preparation; no global registry, hidden side channel or fake bridge interception. CLI preflight and generation must use identical session state and budget, preferably through a session preparation method.
- Update history and persona state only after validation and the final abort boundary. Defensive copies prevent public result/state aliasing. Cancelled, failed or invalid generations change neither state; no retry or extra model call.
- Preserve exact count 2–10/default five, strict message/provenance output, existing username/message limits and included-history-only returning-participant validation. Do not add tone scoring or nickname whitelist rejection. Personality adherence is instructed, not guaranteed by schema validation. No changes to scheduling, timing/pacing, zero-message events or lifecycle.
- Prompt bytes intentionally change in this batch. Replace the old exact-prompt expectation with explicit new style checks and context-free session/one-shot consistency; do not delete boundary/cancellation coverage or claim old prompt bytes are preserved.

## Tasks and checks

- [x] T1 Inspect current prompts, state and preflight.
- [x] T2 Define bounded profiles and honest quality criteria.
- [x] T3 Implement with behavioral RED, GREEN and triangulation.
- [x] T4 Complete required verification and hand off a human comparison.

TDD ON from `AGENTS.md` and `.pi/skills/electron-testing/SKILL.md`. Use existing local Node 22.23.2/npm 10.9.8 and pinned Vitest. Missing imports alone are not RED. Required commands:

- `.local/toolchains/run-npm test -- --run tests/codex-personality.test.ts tests/codex-chat.test.ts tests/codex-session.test.ts tests/codex-chat-cli.test.ts tests/codex-session-cli.test.ts`
- `.local/toolchains/run-npm test -- --run`
- `.local/toolchains/run-npm run typecheck`
- `.local/toolchains/run-npm run npc:chat -- --help`
- `.local/toolchains/run-npm run npc:session -- --help`
- `git diff --check`
- `git status --short`

Test deterministic assignment/cap, normalized identity stability, history-eviction independence, defensive copies, no state change on failure/cancellation, exact escaped budget including maximal profile state, same preflight/generation, unchanged returner semantics and one-call behavior. Record protected hashes before edits. Roughly 400 changed lines is advisory, not a cap; no minification or omitted tests.

Human-only comparison: use the same four supplied events (fall; cautious retry; successful jump but death on landing; request to be kinder). Judge distinct recurring voices, natural fragments, uneven emoji/joke density, direct participation, appropriate teasing and no invented memories. Handwritten examples are references, not generated evidence or required catchphrases. Fixed batch size and absent message pacing remain known realism limits.

## Evidence and next step

At mapping time, parent confirmed expected dirty paths and that shared preflight lacked persona input. Baseline: 299 synthetic tests from the prior batch. Mapping's proposed unchanged request API cannot carry per-session profiles; allow additive inputs and a minimal matching CLI preflight change. Mapping's budget fallback would remove identities; instead keep bounded profiles and report local overflow honestly.

T3 writer reported one observed behavioral RED in the shared-style assertion, then 52 core tests GREEN and final 106 focused/308 total tests across eleven files passing. Typecheck, both executable helps and Git checks passed. Eight scoped files changed; `tests/codex-chat.test.ts` needed no edit. Full before/after hashes for 17 protected files were supplied as equal. RED remains writer-attributed.

Native assessment returned unavailable/empty output and required independent verification. That verification closed PASS: 106 focused and 308 full tests, typecheck, both helps and Git checks passed. All 17 protected hashes matched the supplied baseline and prior snapshot blobs; the untouched old chat test also matched. Session CLI changed only its event-preflight delegation. Parent repeated both help commands and whitespace checks successfully.

Independent fake-only probes covered maximal six-character username escaping: eight profiles plus a one-character event used 3,676 characters; a 325-character ASCII event exactly filled 4,000, and one more character was rejected locally without a call. All profiles persisted with history evicted. These probes are not persisted regression tests; checked-in coverage uses quote/backslash expansion. No functional blocker was found, and no human-tone claim follows.

Native review `review-55fc9fd896503e5e` approved the 22-path accumulated candidate after four admitted lenses, without corrections. Exact acknowledgement completed and authority was burned. Approved tree: `10693c6486ea55e3addd44bed5b9cb47b43f9d11`; target: `sha256:8345da75850760e266c7642d9d3e01a33e232731075c10bc5d174609f7d84afb`; consumed revision: `sha256:69af5e802f86a26f52e2e37f837027a48487dd26fea64b0681b9d44d0d3a4431`. This administrative tracker closure is outside that frozen approval.

Two informational WARNING advisories remain separate later work, not correction authority: `R3-late-abort` at `src/npc/chat.ts:194-195` and `R4-stdout-failure` at `src/npc/session-cli.ts:253`. Neither reopened the approved review. The first acknowledgement call supplied an unsupported controller-only input and was rejected without mutation; resubmission with only the exact lineage completed. Post-ack assessment with explicit closed outcome still returned native empty output/unassessable; both writer and independent verification already passed. No tool synchronization or settings changes occurred.

Handoff: start a fresh session with `.local/toolchains/run-npm run --silent npc:session -- --count 5`, repeat the same four events individually after each ready prompt, and share only result JSON, never login codes. No human trial has run with this style; comparison remains pending. Technical verification and handoff are complete, not a claim of naturalness. No staging, commits, push or next batch.
