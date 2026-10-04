# Shared chat pacing and entrance animation

## Authorization and outcome

The user tested the overlay on OBS 32.1.2 and rejected whole batches appearing simultaneously. They explicitly approved pacing and animation in BOTH panel and overlay, then selected waiting for the displayed batch to finish before the terminal accepts another event.

Show the first message immediately, subsequent messages at variable 1–3 second intervals, with a subtle approximately 200 ms opacity/short-translation entrance. Keep one model generation per manual event and existing voices/model. Real OBS platform, alpha and lifecycle acceptance remain unconfirmed. This is a new authorized batch after the completed OBS presentation batch, which intentionally excluded pacing.

## Contract

- Use one server-side presentation schedule, shared by all views. No per-browser stagger queues, no per-message inference, no burst flush or multi-event backlog. Bound pending work to one copied validated batch (at most ten messages), one reveal timer and the existing 100-message visible history. Reject reentrant publication before mutation rather than accumulating work.
- Prefer a small `pacing.ts` controller composing the existing immediate `PresentationPublisher`. Keep immediate publishing available for transport tests and synchronous callers; `npc:serve` explicitly composes the paced controller with production scheduler/random defaults. Do not make production pacing depend on a test-only option.
- Reveal the first message synchronously when accepting a batch. Choose each following delay in the inclusive 1000–3000 ms range; inject clock/scheduler and randomness for deterministic tests. Pending messages must never appear in snapshots. Resolve publication only after the last message is published, not after remote render acknowledgement or CSS animation completion.
- Extend the typed publication callback additively to accept an optional AbortSignal and return void or Promise<void>. The session CLI waits for asynchronous presentation before showing `event>` again. Preserve existing no-hook/synchronous behavior without introducing an unnecessary await boundary. Keep stdout JSON once per generated batch before presentation, existing validation and final cancellation guards, and one sign-in/generation path.
- While generation or presentation is busy, retain existing complete-line discard behavior. `/exit` works at a ready prompt; Ctrl+C/SIGTERM interrupts busy presentation. EOF allows the accepted batch to finish, then exits. Do not buffer typed busy events or infer for rejected work. Document the longer busy period and that terminal JSON is not paced.
- Cancellation must stop the active reveal timer immediately, settle the waiting promise, remove the abort listener and prevent any later reveal, even while bridge cleanup is pending. Handle already-aborted signals and late timer callbacks after cancellation. Give the serve composition explicit idempotent controller stop/dispose ownership before server cleanup on all exit/failure paths. Do not refactor the unrelated startup-signal window.
- Give every revealed message a stable presentation-only ID, not an array position or text comparison. Include a publisher-instance/stream identity in snapshots so restarts cannot alias old IDs. IDs are assigned by trusted presentation code, not requested from the model. Preserve username/message text exactly and defensive snapshots; no events, credentials, provenance, personas or pending content in the wire projection.
- Keep SSE `event: snapshot` and the transport implementation unchanged. Snapshots contain only visible history. Update the renderer by stable IDs: remove expired rows, append new rows, preserve surviving DOM nodes, and animate normal new arrivals only. Identical message text from the same participant still represents distinct arrivals. Never reanimate unchanged history or recreate all rows on every normal update.
- Initial connection and reconnect restore the currently visible snapshot silently; later live arrivals animate. A new stream resets state silently. If intermediate snapshots were coalesced/missed, reconcile the already-revealed state without replaying its timing or staging a new local backlog. Full snapshots retain at most 100 messages; they are not an unlimited lossless replay log.
- Preserve latest-ten overlay/100-message panel, transparent root/body, safe textContent rendering, strict CSP, narrow-dock scrolling and no external assets. Use CSS opacity/transform entrance only and honor prefers-reduced-motion. Avoid per-row timer queues. Actual browser animation/scroll behavior and OBS fidelity need human validation.
- Freeze the corrected HTTP security, eight-client limit, drain/coalesced pending snapshot and five-second stalled-client destruction. No dependencies, configuration changes, provider changes, audio/vision, connectors, installs, native Codex/auth/inference, browser/OBS automation, global tool/settings changes, staging, commits or push.

## Product context setup

The first T3 writer stopped before edits or TDD because Impeccable requires PRODUCT.md. The user explicitly authorized PRODUCT.md as one additional edit surface and the required context setup, not a gate exemption. They then confirmed in a structured interview:

- Register: product, a streaming tool for the person broadcasting, reading simulated chat and displaying it in OBS, not a promotional website.
- Personality: familiar, discreet and readable. Reference the familiarity of Twitch/YouTube chat without claiming affiliation or live-platform integration.
- Anti-references: overloaded dashboards, decorative clutter and animation that competes with the content.
- Accessibility: readability in narrow docks, comprehensible states without color-only meaning and reduced-motion support. Do not claim unverified conformance or an authorized full WCAG audit.

Create a concise English PRODUCT.md from these confirmed answers and existing repository evidence, distinguishing current manual-event presentation from future microphone/program-image ambitions. Strategic principles must serve readable, unobtrusive, transparent simulated conversation, user control and accessibility, not introduce new features. Do not invent brand assets, user research, proven naturalness, OBS acceptance or certifications.

The same scoped writer must complete this context file first, refresh the full Impeccable loader result and satisfy the applicable preflight before T3 source edits. Load the product register and animate references. This is the already-approved subtle arrival animation, not a craft/redesign task; no new layout, colors or typography are authorized. No image mock is needed for this bounded existing-interface motion change; actual runtime remains human-verified. DESIGN.md is optional and remains outside scope, as do AGENTS/skill/global settings changes. No additional paths are authorized.

## Writer surfaces

New:
- `PRODUCT.md` (confirmed strategic context bootstrap only)
- `src/npc/pacing.ts`
- `tests/codex-pacing.test.ts`

Existing:
- `src/npc/publisher.ts` (presentation identity and additive publication type only; immediate publishing remains)
- `src/npc/session-cli.ts` (cancellable async publication completion boundary only)
- `src/npc/serve-cli.ts` (paced composition, deterministic injection seam and disposal)
- `src/npc/presentation-view.ts` (identity-based reconciliation, animation and reduced motion)
- `tests/codex-publisher.test.ts` (identity and callback contract coverage)
- `tests/codex-presentation-view.test.ts` (delivered script synthetic DOM and CSS coverage)
- `tests/codex-serve-cli.test.ts` (deterministic pacing/lifecycle coverage)
- `tests/codex-presentation-server.test.ts` (snapshot identity expectation adaptations only; preserve all transport regressions)
- `docs/obs-presentation.md` (pacing, terminal wait/cancellation and human animation checks)

Parent alone maintains this tracker. Freeze every other source/test/entrypoint, README, package/lockfile, compiler/test config and previous trackers/guides. Do not weaken large-snapshot, slow-client, publication/cancellation or safe-rendering tests to fit new metadata. Record protected before/after hashes, including pre-existing untracked files. Existing globs cover the new files. Approximately 400 changed lines is advisory: no minification, omitted tests or artificial PR splitting.

## Tasks and verification

- [x] T1 Map publication/rendering/lifecycle and resolve backlog policy.
- [x] T2 Record approved shared cadence and exact edit boundaries.
- [x] T2a Create the explicitly authorized PRODUCT.md and refresh visual context.
- [x] T3 Implement paced publication, identity-based rendering and cancellation with strict TDD.
- [x] T3a Correct the independently reproduced rendering and publication-lifecycle defects, with regression RED first.
- [x] T4 Complete required verification/review and hand off human OBS checks.

TDD ON from `AGENTS.md` and `.pi/skills/electron-testing/SKILL.md`. Use existing local Node 22.23.2/npm 10.9.8 through `.local/toolchains/run-npm` and pinned Vitest. Observe behavioral RED before production changes, then GREEN and triangulation. Missing imports alone are not RED. Technical artifacts and interface copy remain English; existing Spanish chat content is unchanged.

Required foreground writer commands:

```sh
.local/toolchains/run-npm test -- --run tests/codex-pacing.test.ts tests/codex-publisher.test.ts tests/codex-presentation-view.test.ts tests/codex-presentation-server.test.ts tests/codex-serve-cli.test.ts tests/codex-session-cli.test.ts tests/codex-session.test.ts
.local/toolchains/run-npm test -- --run
.local/toolchains/run-npm run typecheck
.local/toolchains/run-npm run npc:serve -- --help
.local/toolchains/run-npm run npc:session -- --help
.local/toolchains/run-npm run npc:chat -- --help
git diff --check
git status --short
```

Use deterministic scheduler/random fixtures, not multi-second sleeps: exact first reveal, delay boundaries, FIFO/duplicate identities, single active batch/timer, pending invisibility, shared subscribers, completion-before-next-input, abort/no late reveal, all disposal paths and unchanged single inference. Exercise actual loopback SSE with fake scheduling for shared gradual delivery/reconnect and preserve all previous real transport regressions. Test the actual served script for stable surviving nodes, initial/reconnect/restart silent restoration, live new-only animation, missed-snapshot handling, retention trim, duplicate text and reduced-motion CSS. Synthetic DOM/CSS checks are not browser or OBS evidence.

## Evidence and next step

Baseline is 340 tests across 15 files from the completed OBS batch. Parent `git status --short` and `git diff --check` show expected accumulated changes and clean whitespace. Previous approved tree is `3c0ee3801b867528736ed44a346a2e4f30fc45e1`, not HEAD; only administrative OBS tracker closure changed afterward. No delivery occurred.

Parent rejected the mapper's overflow catch-up burst, index/content-based identity and claim that retained snapshots are universally lossless. The user resolved the real tradeoff by choosing a busy terminal until presentation completes; therefore an additive async callback boundary is authorized instead of forcing the old synchronous contract. No unrelated terminal-input rewrite is authorized.

Initial writer mu8i0wj7-k-5cv1 returned interaction_required with no edits and no RED/GREEN/triangulation. It reported the loader hasProduct=false/hasDesign=false and inspected Git status; no protected hash baseline was generated. The parent read the applicable Impeccable setup/teach/product/animate guidance and repository README, presentation guide, package and delivered view, then obtained the explicit scope extension and strategic answers above. No implementation pass is claimed.

Resumed writer mu8idtsh-l-2k2c implemented the twelve-path candidate and reported PRODUCT.md bootstrap with hasProduct=true, behavioral RED, 92 focused tests across seven files, 366 full tests across sixteen files, typecheck, all three helps and Git checks passing. Parent read PRODUCT.md and the changed core source. Historical RED is writer-attributed; controller unit tests added at GREEN are not claimed as RED. At that stage, T2a was complete but T3 was not accepted.

Native ASSESS returned unassessable because the native command produced empty output; it required independent verification. Read-only verifier mu8je5no-m-t4lk independently reran every listed command with the same passing counts, but returned FAIL after executing bounded move-aware VM and public-controller probes:

- HIGH: every retained row is moved through a fragment and reinserted on each snapshot. Object identity survives, continuous DOM attachment does not; actual CEF animation replay is not established.
- HIGH: same-stream reconnect with new history and connected coalesced updates animate restored rows. The current missed-update test incorrectly expects this behavior.
- MEDIUM: synchronous publication subscribers can stop/abort/reenter before ownership is reserved, causing post-stop reveals, extra timers, interleaving or an unsettled promise. The reproductions require synchronous subscriber actions; ordinary production-signal coverage passed.
- LOW: later injected scheduler/random failures leave active publication pending until stop. This does not establish production timer/random failure.
- LOW: an oversized batch is copied before count rejection. No unrestricted external-input route was established.

The verifier also found vacuous drained-queue delay assertions, a reentrancy test that does not actually reenter synchronously, and a production-controller test that substitutes a nonpublishing stub. Replace these with behavioral evidence, not weaker expectations.

Scope evidence: exactly twelve candidate files plus two authorized administrative trackers differed; 51 files were byte-identical against the approved snapshot with HEAD fallback. Protected manifest SHA256: 6537c98ad1832507076126f5eec54d7ceb1a1608a8373d49362eade78ce97d84. Frozen server SHA256: c860e1710e28ecc4b9cc076033f4deb00231798b2604e40c273c23ec09324780. Existing server-test edits only adapt identity parsing/expectations. Hashes prove byte equality, not behavior.

### T3a correction boundary

One writer may edit only src/npc/pacing.ts, src/npc/presentation-view.ts, tests/codex-pacing.test.ts and tests/codex-presentation-view.test.ts. First reproduce the confirmed findings with failing regression tests, then fix and triangulate. Keep surviving rows mounted; restore reconnect/coalesced history silently; reserve batch ownership before synchronous publication; recheck lifecycle after callbacks; settle and release ownership on failure; reject oversized lists before copying. Preserve existing API, cadence, single-inference and transport contracts. Prove real default-controller wiring and meaningful delay assertions without wall-clock sleeps or real provider/browser calls.

Freeze all other candidate files and prior protected files. Parent captured full SHA256 values for PRODUCT.md, publisher/session-cli/serve-cli, publisher/server/serve-cli tests, presentation guide and frozen server before correction. Writer records protected before/after hashes; verifier must compare the nine parent values plus prior frozen scope. Parent alone updates trackers. The correction handoff required every listed verification command to run again and left T3/T3a/T4 unchecked until their evidence settled. Native approval was still pending at that correction handoff.

### T3 and T3a independently closed

Correction writer mu8jvneg-n-mv3o changed only the four authorized files. It observed 13 behavioral RED failures before production fixes, then passed 41 tests across the two changed suites, 104 across the seven focused suites and 378 across sixteen full-suite files, plus typecheck, all three helps and Git checks. Historical RED remains writer-attributed; already-passing quality additions are not described as RED.

Read-only re-verifier mu8l4thq-o-14lz independently returned PASS. It reran every required command with the same counts and successful results, plus one Python scope/hash script and two Node22/tsx reproduction scripts. All probe assertions passed; no failed probe invocation. It independently closed all five prior findings:

- Both views preserve continuous attachment and node identity through arrivals, repeated snapshots and retention trimming; surviving detach counts remain zero.
- Same-stream error/open reconnect, connected coalesced history and new-stream restoration are silent. The following ordinary single arrival animates; old entrance state clears. Initial-empty and restart transitions passed.
- Stop/abort during first and second publication settles once with zero remaining timers/listeners and no late reveals. Nested publication rejects with session_busy before mutation; the outer batch completes.
- First/later injected scheduling and random failures release ownership and reject. First subscriber exceptions propagate synchronously; later ones reject without escaping the timer callback. Subsequent work succeeds; zero observed unhandled rejections.
- Oversized getter/Proxy batches reject with zero element/property reads and zero publication; subsequent valid work succeeds.

Meaningful recorded-delay assertions, true callback reentrancy, the real default serve-controller path with fake time, disposal-order coverage and move-aware DOM assertions were independently audited. Safe text, duplicate content, view limits, panel scroll/overlay positioning, reduced-motion CSS, blocked-bridge cancellation, busy lines, EOF and signals passed. Minor test-title caveats remain: an older reentrant title covers concurrent busy rejection, and the SSE silent-reconnect title is payload-only; separate tests and probes provide the missing behavioral evidence.

All nine parent pre-correction hashes matched exactly. The same 51 protected files and manifest 6537c98ad1832507076126f5eec54d7ceb1a1608a8373d49362eade78ce97d84 remained unchanged; exactly twelve cumulative candidate files plus two authorized administrative trackers differed. No unrelated mutation or correction-boundary violation was observed. File equality does not establish runtime correctness.

T3 and T3a are accepted within the synthetic/Node scope. Independent PASS is distinct from native approval and actual OBS acceptance.

## Native closure and human handoff

Native review review-6d2ffbe026ac5fb2 approved the accumulated 37-path candidate after all four provider-selected lenses were admitted. Its 5,614 original changed lines and 200 logical-correction budget were controller-derived; no native correction was opened. The exact approved acknowledgement completed and burned its authority. No staging, commit, push or other delivery operation was performed.

- Reviewed tree: 9fcba1059df62869c66e495ac7e85e4016ef6605.
- Target: sha256:a1692ff4b12a61061629631516d49b2245194233b529d5d33bdb79330a36010e.
- Consumed revision: sha256:65b7ec8615883ccea658039bc2b935f609595470be6f1f734d7f239d17660193.
- The first consent envelope expired without native invocation, lineage creation or mutation. A fresh inspection and consent attempt created the review successfully; no stale binding was replayed and no maintenance/reset was used.

Five informational WARNING advisories remain separate later work: R2-incomplete-snapshot-count at tests/codex-presentation-server.test.ts:59-61; R3-incomplete-snapshot-count at the same file:59-62; R3-late-abort at src/npc/chat.ts:194-195; R3-stdout-error at scripts/npc-session-cli.ts:11; and R4-stdout-error at that entrypoint:10. Native approval stands; none opened a correction or authorizes rerunning this review. Do not expand this batch to fix them.

This final tracker closure is an administrative update after the reviewed snapshot, not reviewed implementation. Compare the current tree against the reviewed paths allowing only this tracker to differ. Source, tests, PRODUCT.md and the presentation guide must remain unchanged.

The implementation batch is complete. Human handoff: stop any previous npc:serve process, restart with `.local/toolchains/run-npm run --silent npc:serve -- --count 5`, and reload the panel and overlay URLs in docs/obs-presentation.md. Restart loses in-memory history and uses the existing same-process sign-in flow. The first message appears immediately after generation; the rest follow at variable 1–3 second intervals, sharing the server schedule. event> returns after the last publication; terminal JSON still prints the entire generated batch. Ctrl+C cancels pending reveals. Verify subtle entrance, silent history restoration after reload/reconnect, shared ordering, alpha/readability, scene lifecycle and reduced motion where supported. Record the actual OBS platform/package alongside user-reported OBS 32.1.2.

No actual browser/CEF/OBS acceptance is claimed. Existing local guidance still applies; frontend-design was unavailable and was not installed or vendored. Stop after this batch. Voice/model tuning and microphone/program-image capture remain deferred; real model/OBS calls remain human-operated.
