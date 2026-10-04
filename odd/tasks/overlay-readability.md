# Overlay readability

## Authorization and confirmed brief

The user approved an overlay-only adjustment after testing actual OBS: inline participant names/messages, larger text and less invasive backgrounds. Their Browser Source is 800 × 1080 with no reported manual scene resizing. The reading panel looks good and must remain unchanged, as must shared pacing. The parent inspected the user-selected screenshot through the mounted Windows drive; do not copy its private path, image or account details into this repository.

This is a new implementation batch. The previous chat-pacing review is closed; its approval does not approve new styling. PRODUCT.md already contains the confirmed product register and familiar/discreet/readable direction. No additional interview, PRODUCT/DESIGN file or redesign of other surfaces is authorized.

## Design and boundaries

- Change overlay-scoped CSS only. Preserve the complete markup generation and PRESENTATION_SCRIPT byte-for-byte. Preserve every non-overlay CSS rule, including panel typography, shared wrapping and entrance/reduced-motion rules.
- Use an overlay font size of clamp(24px, 3.5vw, 32px), giving 28px at the confirmed 800px width. Names inherit this size rather than the small shared .78rem size. Keep them inline with messages, with a readable colon/space separator supplied by overlay CSS. Keep long names and messages wrappable; do not introduce truncation or nowrap.
- Remove full-width dark row plates. Keep the page and rows transparent, with restrained dark text shadow to support contrast over scene imagery. Retain the established text/name colors; no new branding, badges, avatars, fonts, assets or controls. Contrast on arbitrary game backgrounds remains an actual OBS acceptance question, not a certification claim.
- Give the overlay a fixed viewport-height border-box frame with bounded overflow. Its auto-height message list must not shrink: bottom alignment should keep newest messages visible while older content clips above the frame when it no longer fits. Account for frame padding. Do not rely on min-height alone, document scrolling or a shrinking flex list. Do not add per-row heights or change the ten-message data cap.
- Preserve safe textContent rendering, stable IDs/mounted rows, silent initial/reconnect/coalesced restoration, one shared server schedule, first-immediate/subsequent 1–3 seconds and existing approximately 200ms entrance. Do not touch animation behavior, terminal waiting/cancellation, inference, voices/model, publisher or HTTP/SSE transport.
- No dependencies, scaffold, configuration, global settings, skill changes, installs, screenshot copies, browser/OBS launch, native Codex/auth/inference, audio/vision, staging, commits or remotes. Real OBS and provider operation remain human-run. Stop after this batch.

## Exact writer surfaces

1. src/npc/presentation-view.ts: only overlay-specific selectors inside PRESENTATION_CSS.
2. tests/codex-presentation-view.test.ts: stylesheet-contract assertions and guards; existing VM behavior tests unchanged.
3. docs/obs-presentation.md: brief description of overlay typography, transparent rows, viewport clipping and manual checks.

Parent alone maintains this task file and its full Engram mirror. Freeze all other files, including PRODUCT.md, prior trackers, guides, source, tests, package/lockfile and configuration. Compare shared CSS and the source outside its CSS template against the pre-edit version, not just the complete file hash. No optional cleanup of inherited test titles or native advisories.

## Tasks

- [x] T1 Map the styling surface and confirm the overlay-only brief.
- [x] T2 Implement the overlay CSS, regression checks and guide update.
- [x] T3 Complete technical verification, required review and human OBS handoff.

## Verification

Use the installed Node 22.23.2/npm 10.9.8 wrapper and pinned Vitest. Strict TDD from AGENTS.md/local testing skill applies: first observe new served-stylesheet contract assertions failing on the old CSS, then implement and rerun. Label this CSS-contract RED/GREEN, not actual browser layout, sharpness or alpha evidence. No missing-import/config failure counts as RED.

Tests must check overlay-only larger type and inline separator, transparent rows, fixed frame/padding bounds, nonshrinking bottom-aligned content and unchanged shared/panel styles. Keep existing script tests for attachment, safe text, duplicate messages, caps, restoration and animation behavior unchanged and passing. A CSS-source assertion proves only the declared rules, not their rendered geometry; do not manufacture geometry in a fake DOM and call it browser verification.

```sh
.local/toolchains/run-npm test -- --run tests/codex-presentation-view.test.ts
.local/toolchains/run-npm test -- --run tests/codex-pacing.test.ts tests/codex-publisher.test.ts tests/codex-presentation-view.test.ts tests/codex-presentation-server.test.ts tests/codex-serve-cli.test.ts tests/codex-session-cli.test.ts tests/codex-session.test.ts
.local/toolchains/run-npm test -- --run
.local/toolchains/run-npm run typecheck
.local/toolchains/run-npm run npc:serve -- --help
git diff --check
git status --short
```

Capture protected before/after hashes for nonignored public repository artifacts, including accumulated untracked files; do not inspect credentials, private data or unrelated machine files. Reviewed tree 9fcba1059df62869c66e495ac7e85e4016ef6605 is the previous candidate, not HEAD. Only administrative chat-pacing tracker closure differed afterward, before this new task file. Prior baseline: 378 tests in sixteen files, 104 focused tests in seven files.

## Evidence and remaining checks

Read-only mapper mu8nljz4-1-47ax confirmed styling needs no markup/script changes. Parent selected stronger typography than its 18px proposal and corrected its claim that min-height alone guarantees upward overflow. Both geometry and contrast need actual OBS verification.

Parent refreshed the Impeccable context loader: hasProduct=true, hasDesign=false, migrated=false. Existing PRODUCT.md is valid; DESIGN.md is optional and remains outside scope. The accepted narrow visual brief is already explicit. No image mock is necessary for this existing-interface correction informed by the user's real screenshot; no image-generation tool or browser is being installed.

Official OBS Browser Source documentation was rechecked at https://obsproject.com/kb/browser-source: Width/Height set the page viewport; default custom CSS makes the body transparent, removes margins and hides overflow. CEF behavior, source unload when hidden and refresh on activation remain relevant, but documentation does not prove this installation's rendering.

## Implementation and independent verification

Writer mu8nvvki-2-aa18 changed exactly the three approved paths: overlay CSS (+4/-2 lines), six new stylesheet-contract tests plus helper (+70 lines), and guide (+4 lines). It reported CSS-contract RED of five failures and sixteen passes against the old CSS, followed by 21 passing view tests. Historical RED remains writer-attributed, not independently established. No missing-import failure or browser-rendering proof is claimed.

Native ASSESS was unavailable (native command returned empty output), so the independent-verifier path was required. Read-only verifier mu8o467j-3-pf35 independently returned PASS: 21 view tests, 110 focused tests across seven files, 384 full tests across sixteen files, typecheck, serve help, Git checks and explicit whitespace checks on the three untracked edit paths all passed. No failed command or unexpected mutation was observed.

The baseline comparison found 65 reviewed files and 66 current public/nonignored files. Exactly the three writer paths and two authorized administrative exceptions differ; 61 protected baseline files are byte-identical. This establishes comparison to the reviewed baseline, not the writer's historical before/after execution. Original test content is preserved byte-for-byte, with fifteen existing tests and six additions. Source outside the CSS template and every non-overlay CSS line are unchanged. Shared CSS has sixteen nonempty lines, not eighteen rules.

Preserved fragment SHA256 values:
- Prefix including HTML generation: f31dc81276c2684430da97755a736d0c5c12b3136889a21df19045b4f3b0fb86.
- Non-overlay CSS: 7fd9e474bf723eca4ce036a8269c3906bc83887e813d91f013ac31c0aa64fda1.
- Suffix including JavaScript: b6e4af5c9ea211ee7d91d539799de6bb2ad391d1a64bb1ad52752a32623588a1.

Verification-start/end manifest matched: 0df7d4fe3b13c6ee7ab7036e30481a3cf1b7b21054aa9099e07a6136e724f80c. The verifier independently inspected current declarations and their overlay specificity, fixed frame/padding and nonshrinking bottom alignment; documentation matches the implemented intent. These are static/synthetic findings, not rendered geometry.

Nonblocking test-coverage limitation: substring assertions are not a CSS parser or complete cascade proof. One inline assertion also accepts inline-block, and the list/frame assertions do not individually require every relevant declaration. Current declarations were inspected and are correct. No extra cleanup is authorized solely for this limitation.

## Native closure and human handoff

Fresh native inspection selected all 34 intended untracked paths plus four tracked changes. Review review-24665c9773752c41 approved the accumulated 38-path candidate after four provider-selected lenses; 5,782 original changed lines and a frozen logical correction budget of 200. No correction was opened. The exact approval was acknowledged successfully and authority burned; this is not a Git commit or delivery authorization.

- Reviewed candidate tree: 62f2a4b90d4f91de9972962bdecf0362c2222397.
- Target: sha256:78ecc7c54dadda7d2477303fd103a3e4796d111e7ee02be0037a15e890d07012.
- Consumed revision: sha256:158d28c7b8647e1894b54cd01b0e2fd479a971354234af609596232fba73ee6b.

Five nonblocking informational WARNING advisories remain separate future work: R2-incomplete-snapshot-count (tests/codex-presentation-server.test.ts:59-61), R3-incomplete-snapshot-count (same file:59-62), R3-late-abort (src/npc/chat.ts:194-195), R3-stdout-error and R4-stdout-error (scripts/npc-session-cli.ts:10). None reopens this review or authorizes corrections in this batch.

Technical work and handoff are complete; human OBS acceptance remains open. Restart npc:serve with `.local/toolchains/run-npm run --silent npc:serve -- --count 5`, refresh the existing 800 × 1080 source and compare the unchanged panel and revised overlay over both dark and bright scenes. Check inline names/separators, larger text, long-message wrapping, newest-message visibility with overflowing history, transparency, reload and scene lifecycle. Verify actual output separately if sharpness remains in question: scene-preview screenshots do not prove encoded-output sharpness or universal contrast. User-reported OBS version is 32.1.2; platform/package and lifecycle settings can be collected if needed. No further edits, provider calls, browser/OBS operation or Git delivery are authorized by this closure. Only this administrative task closure is added after the reviewed snapshot.
