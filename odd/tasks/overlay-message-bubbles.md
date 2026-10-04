# Overlay message bubbles

## Authorization and design

The user reports that the larger inline overlay now looks good in OBS. They request an individual textbox/backplate for each message because scene backgrounds can be white or black, and explicitly delegate color/style decisions. This is visual acceptance of the previous readability change, not evidence of exhaustive lifecycle or encoded-output checks.

Implement compact ink-blue message bubbles: opaque dark tinted fill, fine full border, restrained rounded corners and comfortable padding. Size each bubble to its content, bounded by available width, instead of restoring full-width message plates. Preserve transparent space outside the bubbles. The physical setting is readable chat superimposed on unpredictable bright/dark streaming imagery; the solid local backdrop protects the existing light text independently of scene color. No glass blur, gradients, decorative badges or new effects. Prefer existing-compatible CSS, with a conventional color fallback if using OKLCH.

Preserve the accepted 28px text at an 800px viewport, inline name/separator/message, wrapping, bottom-aligned clipped history, ten-message data cap and existing animation/reduced-motion behavior. Panel, markup and JavaScript must remain byte-identical. Do not alter publisher, pacing, transport, CLI, inference, personas, configuration, dependencies or product context.

## Allowed writer surfaces

- src/npc/presentation-view.ts: overlay CSS selectors only.
- tests/codex-presentation-view.test.ts: overlay stylesheet contracts only; preserve all existing VM behavior tests.
- docs/obs-presentation.md: replace obsolete transparent-row description and update manual checks.

Parent alone maintains this file and its full Engram mirror. All other public artifacts stay unchanged. Preserve accumulated uncommitted work. No staging, commits, remotes, installs, browser/OBS launch, provider authentication/inference, credentials, screenshots, global settings or skill changes.

## Tasks

- [x] T1 Implement message bubbles, CSS-contract regressions and guide update.
- [x] T2 Verify scope and checks, complete applicable native review, and hand off human OBS testing.

## Verification contract

Strict TDD is enabled by AGENTS.md. Use the installed Node 22/npm wrapper with pinned Vitest: observe failing stylesheet-contract assertions before implementation, then GREEN and triangulation. Tests establish declarations, not browser geometry. Use exact declaration checks rather than loose substrings where practical. Cover solid local background, content-fit bounded width, padding/border/radius, preserved transparent page, inline typography and viewport constraints. Preserve script behavior tests. Baseline: 21 view tests, 110 focused tests, 384 full tests across sixteen files.

Required writer commands:

```sh
.local/toolchains/run-npm test -- --run tests/codex-presentation-view.test.ts
.local/toolchains/run-npm test -- --run tests/codex-pacing.test.ts tests/codex-publisher.test.ts tests/codex-presentation-view.test.ts tests/codex-presentation-server.test.ts tests/codex-serve-cli.test.ts tests/codex-session-cli.test.ts tests/codex-session.test.ts
.local/toolchains/run-npm test -- --run
.local/toolchains/run-npm run typecheck
.local/toolchains/run-npm run npc:serve -- --help
git diff --check
git status --short
```

Also directly check whitespace on edited untracked files and compare public protected before/after bytes, including all markup/script and non-overlay CSS. Prior approved tree: 62f2a4b90d4f91de9972962bdecf0362c2222397. Its only subsequent difference before this new task was administrative closure of odd/tasks/overlay-readability.md. Compare actual writer-start/end separately from historical reviewed-tree differences; do not conflate the two.

## Evidence and pending acceptance

Parent inspected current overlay CSS: a scoped row rule can provide bubbles without markup/script changes. Prior Impeccable context is valid (hasProduct=true, hasDesign=false); this is general design refinement with user-authorized discretion, not the craft subcommand. Image generation is unnecessary for this narrow existing-interface adjustment and no browser tools are installed for it. The unavailable frontend-design skill must not be vendored. Existing PRODUCT.md remains authoritative.

## Implementation and independent verification

Writer mu9o27ny-1-cf99 changed the three authorized paths only. It reported CSS-contract RED of three failures and twenty passes, then GREEN of twenty-three view tests. Historical RED remains writer-attributed. Triangulation caught an overbroad width substring assertion matching max-width; it was corrected to a declaration-boundary regex. No production JavaScript or markup changed.

The parent inspected the three changed sections and independently reran the view suite: 23 passed. Native ASSESS returned unassessable (native command returned empty output), requiring independent verification. Read-only verifier mu9oa2mp-2-wopv returned PASS: 23 view tests, 112 focused tests in seven files, 386 full tests in sixteen files, typecheck, serve help, Git checks and direct whitespace checks all passed. No unexpected public-file mutation or blocking finding was observed.

The verifier compared against the prior approved tree and confirmed exactly three writer changes plus the two known administrative exceptions. All three writer hashes matched. Its before/after 67-public-file manifests matched 02396dc14c0e87659ce311ccd6e8e5b64f0a1236e92e7c8761a94efdf41a41ed. Everything outside the single overlay li rule is byte-identical, including panel, markup, script and animation. The preceding fifteen tests are unchanged; these include document/CSS checks as well as VM tests. Overlay stylesheet contracts increased from six to eight.

Current declarations use an opaque #142139 fallback followed by oklch(0.25 0.05 262), a full 1px #4d638b border followed by oklch(0.5 0.07 262), .5rem radius, .5rem .8rem padding, block display, fit-content width, max-width:100% and border-box sizing. The verifier inspected cascade, wrapping, fallback ordering and preserved frame/list constraints. Substring assertions are not a CSS parser or proof of rendered geometry. No writer contrast numbers or universal claims about ink-blue contrast were independently adopted. Opaque describes the base fill, not every frame of the unchanged opacity entrance.

## Native closure and handoff

Fresh review review-708115ef4038e2f9 approved the accumulated candidate after all four selected lenses. Native selection included 35 intended untracked files and four tracked changes, 39 paths total, 5,886 original changed lines and logical correction budget 200. No correction opened. The exact approval was acknowledged successfully and its authority burned. Authority-store acknowledgement is not a Git commit or delivery authorization.

- Reviewed tree: 2c8c887abe75fa62d965f68a039ccd458b0241f8.
- Target: sha256:8e065d72f0b1910fd25b1fe29c6209bac1ddbb62677717e20026b5209f7ae170.
- Consumed revision: sha256:0e382932e4216475fdc402fe91738668644b7c120bd58e3eb9aceea4b581d4ea.

Five nonblocking informational WARNING advisories remain separate future work: R2-incomplete-snapshot-count (tests/codex-presentation-server.test.ts:59-61), R3-incomplete-snapshot-count (same file:59-62), R3-late-abort (src/npc/chat.ts:194-195), and R3-stdout-error/R4-stdout-error (scripts/npc-session-cli.ts:10). None reopens this review or authorizes changes in this batch.

Technical work and handoff are complete. Restart `.local/toolchains/run-npm run --silent npc:serve -- --count 5` and refresh the existing OBS source, retaining 800 × 1080. Human acceptance of the new bubbles remains open: test short/long messages over white, black and mixed scenes; check outside transparency, wrapping, bottom clipping, reload and unchanged panel/motion. No universal contrast, CEF geometry or encoded-output sharpness claim follows from CSS tests or native review. Only this administrative tracker closure is added after the reviewed snapshot. Stop after this batch; no Git delivery or unrelated edits.
