# Shared local reading panel and OBS overlay

## Objective and authorization

The user approved a reading panel and transparent OBS overlay as two views of the same simulated conversation, using localhost-only URLs. Keep manual terminal events, current provider/model and existing voice guidance. Voice tuning and a possible model replacement are deferred after the user found the second human trial functional but still uncanny.

This batch implements presentation, not the microphone/vision MVP. Do not configure OBS, capture audio/video, authenticate or infer against a real provider, install dependencies, change global settings/tools, or stage/commit/push. Preserve all earlier uncommitted batches. Technical artifacts and interface copy are English; generated Spanish chat text remains unchanged.

## Design and boundaries

- Add `npc:serve` as a same-process wrapper around the existing session CLI: one managed sign-in, one sequential generation per accepted manual event. Keep `npc:chat` and `npc:session` compatible. No subclassed session, generation fork, browser controls or inference endpoint.
- Add a typed optional synchronous batch callback at the session CLI's successful output boundary. After the existing post-generation abort check and successful synchronous stdout write, check cancellation again before invoking the callback once. Do not scrape JSON stdout or expose the bridge. This does not claim asynchronous stdout delivery acknowledgement.
- Start HTTP through the wrapper's startup composition after CLI argument/TTY validation and before bridge authentication; always close it on startup/login/generation/cleanup failure, EOF, `/exit`, or interruption. Port-busy failure must occur before starting/authenticating the bridge. Browser disconnect never retries inference or stops a healthy terminal session.
- Use Node built-in HTTP and server-sent events, without dependencies or build tooling. Bind only `127.0.0.1`, default port 4177; `--port` accepts 1024–65535, never a host override or automatic alternate port. Tests may use an ephemeral port through the server API. Print the two canonical local URLs to stderr, never into JSON stdout.
- Serve `/` as a reading panel, `/overlay` as a transparent overlay, `/events` as read-only SSE, and exact static JS/CSS routes. No filesystem/static-directory exposure. Only explicitly supported GET routes; reject other methods and bodies, with bounded HTTP header/request handling.
- Check the exact canonical Host including the actual listening port. When Origin is present, require the exact local origin; reject null/cross-origin values. Same-origin EventSource may omit Origin, so absence alone is not an error. Reject cross-site Fetch Metadata when present. No permissive CORS; use no-store, nosniff, same-origin resource policy and strict CSP with self-hosted scripts/styles, no inline/eval exemptions. These guards are not authentication against other local processes.
- Publish only a copied projection of validated username/message pairs. Never send event inputs, login details, errors from the provider, model provenance, persona roster or other internal state to the browser. Do not weaken existing validation or cancellation behavior.
- Retain at most 100 messages in memory, independent of the model's three-turn history. Cap simultaneous SSE clients at eight. A false write return signals backpressure, not a dead client: wait for drain while retaining at most one latest pending snapshot, without resending the frame already accepted by write. Use a finite stall deadline that newer publications cannot extend; destroy genuinely stalled connections and release their slots/listeners/timers. Healthy full-size snapshots must stay connected. Clean up all owned resources on disconnect and shutdown.
- Send a complete bounded snapshot immediately on connection and on publication. Replacing the displayed snapshot avoids replay duplication, missing-history gaps and obsolete sequence cursors; reconnect/reload restores current retained messages, not another generation. Reconnection after process restart must accept fresh empty/new state rather than suppress it behind an old revision. No persistent storage.
- Safe client DOM rendering uses textContent/createTextNode, never untrusted HTML. Both views consume the same snapshot; the panel can show retained history while the overlay shows the latest ten messages, bottom-aligned. Preserve Unicode and long-word wrapping. Do not add message pacing or alter batch size.
- Keep the UI modest and readable in a narrow OBS dock: restrained dark panel, clear participant names, consistent spacing, visible panel connection/empty states, reasonable contrast and no external fonts/assets. Overlay background is explicitly transparent; omit operational chrome from the public view. Panel scrolling should not force the reader away from older messages on every update. No Electron/React scaffold.

## Allowed writer surfaces

New files:
- `src/npc/publisher.ts`
- `src/npc/presentation-server.ts`
- `src/npc/presentation-view.ts`
- `src/npc/serve-cli.ts`
- `scripts/npc-serve-cli.ts`
- `tests/codex-publisher.test.ts`
- `tests/codex-presentation-server.test.ts`
- `tests/codex-presentation-view.test.ts`
- `tests/codex-serve-cli.test.ts`
- `docs/obs-presentation.md`

Existing files:
- `src/npc/session-cli.ts` (typed optional publication callback/imports and its output-boundary cancellation check only)
- `package.json` (the new script only)
- `README.md` (presentation usage and honest verification limits only)

Parent alone maintains this tracker. Freeze Codex modules, chat/session/personality logic, old entrypoints/tests/fixture, previous task documents/guides, lockfile, tsconfig and Vitest config. Existing include globs already cover the selected new paths. Record protected hashes before editing; compare them afterward. Roughly 400 changed lines is advisory, not a hard cap or permission for minification/test omission. One coherent writer may exceed it; no PR splitting or Git delivery is authorized.

## Tasks and acceptance

- [x] T1 Map current generation/output seams and test/config constraints.
- [x] T2 Define local security, shared state and lifecycle contract; register scope.
- [x] T3 Implement publisher, HTTP/views and same-process CLI composition with TDD. Initial defects addressed in T3a and independently closed in T4.
- [x] T3a Correct healthy SSE backpressure handling and overlay root opacity, with observed regression RED/GREEN.
- [x] T4 Complete applicable independent/native verification, reconcile evidence and hand off real OBS checks.

T3a correction scope is only `src/npc/presentation-server.ts`, `src/npc/presentation-view.ts`, `tests/codex-presentation-server.test.ts`, and `tests/codex-presentation-view.test.ts`. Freeze every other implementation/test/doc/config file; parent alone updates this tracker. No startup-signal refactor or unrelated hardening. Re-run the existing required checks after correction, then independently reverify the two findings and resource bounds.

TDD ON from `AGENTS.md` and `.pi/skills/electron-testing/SKILL.md`; use existing Node 22.23.2/npm 10.9.8 through `.local/toolchains/run-npm` and pinned Vitest. Observe behavioral RED before implementation, then GREEN and triangulation; missing imports alone are not RED. No dependencies or runtime downloads.

Required writer checks (foreground):

```sh
.local/toolchains/run-npm test -- --run tests/codex-publisher.test.ts tests/codex-presentation-server.test.ts tests/codex-presentation-view.test.ts tests/codex-serve-cli.test.ts tests/codex-session-cli.test.ts tests/codex-session.test.ts
.local/toolchains/run-npm test -- --run
.local/toolchains/run-npm run typecheck
.local/toolchains/run-npm run npc:serve -- --help
.local/toolchains/run-npm run npc:session -- --help
.local/toolchains/run-npm run npc:chat -- --help
git diff --check
git status --short
```

Use fake bridge/TTY input for generation, but exercise actual loopback HTTP/SSE in Node tests with ephemeral ports and deterministic teardown. Test valid publication once; failed/invalid/cancelled output and cancellation during stdout never publish; help/bad args/non-TTY/port busy never authenticate; one sign-in; all exit paths close resources. Test hostile Host/Origin/Fetch Metadata, methods/bodies/routes, strict asset/CSP headers, initial snapshots, shared delivery, bounded retention/client count, slow clients, disconnect/reconnect and shutdown. Exercise the actual served client script for replacement, malicious text and restart handling through an honest synthetic harness if no browser is available; do not call such tests browser/CEF evidence.

## Evidence and open runtime checks

T3 writer reported completion across the 13 authorized paths (about 1,046 added/changed lines). Writer-observed RED: the publication callback was invoked zero times in `tests/codex-publisher.test.ts`; focused GREEN: 63 tests across six files. Final full suite: 337 tests across 15 files. Typecheck, all three CLI helps and Git whitespace checks passed. Writer supplied identical before/after hashes for 40 protected paths, including this tracker. RED and protected-baseline claims remain writer-attributed until independently checked. Parent reran `.local/toolchains/run-npm run npc:serve -- --help` and `git diff --check`, both passed.

Native ASSESS returned empty output/unassessable with unknown candidate review outcome, requiring writer self-verification plus an independent verifier. That verifier settled PARTIAL: 63 focused/337 full tests, typecheck, all helps and whitespace checks passed, but two confirmed defects invalidate readiness:

- HIGH, `presentation-server.ts:83-96`: a consuming socket ends after a legal 70,946-byte/53-message snapshot when write returns false. All six frames completed before EOF; no truncation was observed. A full 100-message/141,638-byte snapshot caused each reconnect to end after one complete frame. Regression data: ten validated messages with usernames `String(i) + String.fromCharCode(0).repeat(31)` and messages `String.fromCharCode(0).repeat(200)`. Require sustained delivery through full-size snapshots, reconnect plus later publications, bounded pending data and deterministic stalled-consumer destruction.
- MEDIUM, `presentation-view.ts:29,40`: opaque `:root` background remains behind transparent overlay body. Require transparent overlay root and body while retaining the dark panel. Structural regression does not replace real OBS alpha verification.

The verifier confirmed 39 protected paths against prior snapshot blobs, including the omitted chat-cli hash; existing-file deltas and new paths matched scope. Explicit shutdown destroyed all observed sockets. Twelve paused clients' ended responses left sockets alive at 120 ms but all closed after another 3.2 seconds, with zero queued response bytes; this did not prove unbounded retention or genuine sustained-stall behavior. No additional confirmed defects. Startup signal coverage before server.start resolves and real browser scroll anchoring remain unverified, not authorization for unrelated changes. Historical RED remains writer-attributed. The T3a writer subsequently reported both corrections completed within the four-file scope. Its two-file regression run observed five RED failures, then 16 GREEN tests. Full required checks passed: 66 focused/340 total tests, typecheck, three CLI helps and Git whitespace. It supplied 50 equal protected before/after hashes, including the nine unaffected T3 files whose baseline hashes the parent captured independently.

Correction behavior: accepted backpressure waits for drain, coalesces one latest pending snapshot and uses a fixed five-second stall deadline; expiry destroys the connection and releases owned resources. Overlay root/body are transparent and only panel body is dark. Writer stall coverage used a deterministic scheduler seam. Fresh ASSESS remained unassessable, so independent verification was repeated.

Independent re-verification settled PASS: both findings closed; 66 focused/340 full tests, typecheck, three helps and Git checks passed. A real consuming connection received 12 complete frames including both exact oversized snapshots and later updates without ending; full-size reconnects continued receiving updates. A genuine paused OS socket using the production timer stalled after 20 writes: queued bytes 141,647, maximum observed 142,083. Publications every 100 ms made zero additional writes while blocked; destruction occurred 5,002 ms after the last write. Owned drain/close/error listeners were removed, and replacement delivery worked. This is bounded runtime evidence, not exhaustive load testing. All nine parent pre-correction hashes and 39 earlier protected snapshot paths matched. No unexpected edits occurred. Parent post-correction `npc:serve -- --help` and whitespace spot checks also passed.

Native review `review-825d3c73a38d523a` approved the accumulated 33-path candidate after four admitted lenses, without native corrections. Exact acknowledgement completed; authority was burned. Approved tree: `3c0ee3801b867528736ed44a346a2e4f30fc45e1`; target: `sha256:e95c4c5a2611be3e5ae195a31a5d64a1ab5cf6dfc8fcd01b74505ac248772e8a`; consumed revision: `sha256:5af18a029561fc1e5d7472e4afe2c437a7c3b023d0b5b545b98bd023d35a8a92`. This administrative tracker closure is outside that frozen approval. Post-ack ASSESS with explicit closed outcome still returned native empty output/unassessable; writer and independent checks were already complete.

Four informational WARNING advisories remain separate later work, not correction authority: `R2-incomplete-snapshot-count` at `tests/codex-presentation-server.test.ts:59-61`; `R3-late-abort` at `src/npc/chat.ts:194-195`; `R3-stdout-failure` at `src/npc/session-cli.ts:255`; `R4-stdout-error` at `scripts/npc-session-cli.ts:10`. None reopened the approved review. No tool synchronization, global settings changes or Git delivery occurred.

Human handoff: run `.local/toolchains/run-npm run --silent npc:serve -- --count 5` in a fresh interactive terminal. Use the printed reading-panel and overlay URLs (default `http://127.0.0.1:4177/` and `/overlay`), keep the process running, and enter events individually at the ready prompt. Follow `docs/obs-presentation.md`; share only sanitized results/screenshots and OBS version/platform, never login codes. Technical verification and handoff are complete; real browser/OBS acceptance remains pending.

Baseline from the previous batch: 308 synthetic tests across 11 files; native review approved tree `10693c6486ea55e3addd44bed5b9cb47b43f9d11`. That tree is not a commit on main; the branch remains at `84a8d83875fd36cb89fa8303cbcfc1a8b5c8dfb6`. Parent `git status --short` shows the expected accumulated dirty/untracked paths, and `git diff --check` passed before this batch's tracker was written.

The mapper had no shell and made three unsupported generalizations, not implementation requirements: matching files do not need test/compiler config edits; same-origin SSE need not send Origin; a changed-line estimate does not require PR splitting. Parent corrected these against the current config/source and effective working agreement. SSE is a selected simple option, not the only possible dependency-free transport.

Re-fetched official https://obsproject.com/kb/browser-source: URL input and CEF, shutdown-when-hidden unload, refresh-on-activation reload, transparency defaults and Linux official-package caveat. Documentation is unversioned and does not validate the user's installation. No installed project browser automation dependency exists; no browser installation is authorized. User-level frontend-design was not found in the registry or four conventional skill locations; do not vendor a replacement or claim it was loaded.

Real OBS version/platform, custom browser dock availability, source dimensions/FPS/CSS, hide/show and refresh settings must be recorded during human testing. Verify readability and alpha over contrasting backgrounds, both lifecycle switches, reload/reconnect without duplicate messages, and shutdown behavior. Browser/Node synthetic checks cannot establish OBS compatibility. Provide setup instructions for a custom browser dock when available and a Browser Source URL, but do not operate OBS or claim a completed live trial. Stop after this batch.
