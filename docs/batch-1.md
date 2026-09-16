# Batch 1: isolated subscription compatibility bridge

Batch 1 ends with **one successful authenticated text turn and a bounded Live WebSocket limitation**. The deliverable remains a bounded Node adapter and human-operated probe, **not a production integration**. No Electron, OBS, UI, audio, vision, other-provider integration, deployment, commit, or next batch is authorized by this result.

## Latest human-run evidence

The human ran `npm run --silent codex:smoke > .local/batch1/authenticated-smoke.jsonl`. The parent read only that sanitized report: stdout was redirected, so no terminal stdout was expected; ceremony stderr stayed on the terminal. Never merge or capture it, or share device codes.

- **Setup:** managed ChatGPT subscription authentication with ephemeral credential storage. Account plan and measured setup/authentication timings are omitted for privacy.
- **Text result:** one completed Spanish text turn with matching requested/resolved model `gpt-5.6-luna`, Codex `0.154.0`, default service tier and low effort. The exact response and measured run timings are omitted for privacy.
- **Live:** `gpt-live-1-codex`, text, `websocket`: v3 returned `not_available` / `text_requires_realtime_v2`; v2 returned `not_available` / `realtime_websocket_requires_api_key`. Both stopped at `waiting_started`, with `resolvedModel: null`. No API-key or credits fallback was used.
- **Untested:** `webrtc`, `existingCall`, v1, audio input/output capture/playback, microphone, and v3/audio (including `gpt-live-1-codex`). `gpt-realtime-1.5` was not advertised by the catalog and was not attempted. Spark was not measured.

This proves one actual authenticated text turn, not general entitlement, billing guarantees, general Live impossibility, or a subscription-wide denial. The earlier `included_usage_unavailable` rejecting field remains unknown. The report contains neither shell exit status nor an independent post-report process-teardown observation.

## Review path

| Surface | Contract |
| --- | --- |
| `src/codex/isolation.ts` | Bubblewrap starts from an empty filesystem, fresh memory-only HOME/XDG/CODEX_HOME, and an environment allowlist. Only the selected official native binary, trusted system bubblewrap with five explicit runtime files, public system certificates, and resolver files are mounted. No repository, real home, principal auth, keyring, DBUS, proxies, API keys, SSH, or Node hooks enter the child. |
| `src/codex/policy.ts`, `schema.ts` | Pin Codex 0.154.0; check its generated experimental schema; force ChatGPT and ephemeral credentials, standard service tier and low effort. Disable documented discovery/tool features. Require empty instruction sources and an explicitly empty loaded-thread environment selection. |
| `src/codex/rpc.ts` | Initialize once, then notify initialized; bounded UTF-8 JSONL without a `jsonrpc` header. Register pending requests before writing. Deny every server request with its original ID, expose only a fixed blocked category, and close. Never approve permissions. |
| `src/codex/bridge.ts` | Managed device login, safe account projection, bounded catalog lookup, one active text turn, ordered async delta callbacks, cancellation with interrupt acknowledgement **and interrupted completion**, deterministic owned-child shutdown. |
| `src/codex/live.ts` | A narrow experimental native WebSocket probe, not a realtime architecture. No upstream HTTP client, API auth, microphone, media collection, playback, SDP, or WebRTC dependency. |

The check-only sandbox additionally mounts the existing system shell to assert inaccessible host paths, allowed environment settings, and runnable inner bubblewrap. It reuses the same explicit runtime files; production mounts no shell, and neither path binds broad library directories. Schema generation alone receives a writable mount inside ignored `.local/batch1/`. Empty launch directories and package/schema caches remain there; sandbox state disappears with the process. No auth file is mounted or inspected.

Unsupported namespaces, missing executables, schema differences, effective-config mismatches, or restricted permissions are failures—not reasons to change system policy or mount more host state. The outer sandbox shares networking only when explicitly starting the official server. Its network namespace is isolated during version, schema, and filesystem checks. The readiness check's real server-start phase uses the existing network-enabled official launcher without login or inference.

## Text behavior and stop conditions

1. Read only account type and plan type from the managed account response. Accept known personal subscription plans; reject API-key, external-token, unknown, and usage-based account routes.
2. Select `gpt-5.6-luna` if advertised and supporting low effort. The only alternative is `gpt-5.3-codex-spark`, for a reported Pro plan and an available low-effort catalog entry. Catalog presence is not entitlement.
3. Start an ephemeral read-only thread with `environments: []`, `selectedCapabilityRoots: []`, and `dynamicTools: []`; never send per-turn environment overrides. Require `thread.environments: []`, empty `instructionSources`, no history path, the requested model, default service tier, low effort, and user-owned approvals in the response.
4. Immediately before inference, read `account/rateLimits/read` with `supportsLunaReserve: false` and `excludeResetCreditDetails: true`. Literal `ordinaryUsageAllowed: true` remains mandatory. Each base/applicable bucket requires spend control exactly false or explicit null, reached type explicit null, and at least one valid window; skip only explicit null windows. Every present window must be a non-array object with finite numeric `usedPercent` in `[0,100)`. Missing/malformed values reject. Null spend remains unavailable supplementary information, never authority or recovery. Preserve every codex/exact-model/model-alias bucket; Spark still requires identification. No credit/reset/purchase/nudge methods are called.
5. Request a short ironic Spanish comment about: **El streamer dice que no se caerá y acto seguido cae al vacío**.
6. Emit safe JSON: assistant response, requested/resolved thread model, pinned Codex version, status, first nonempty assistant delta latency, and total latency from turn request through completion. Setup/auth timing is separate; callback execution is not counted as provider latency. Thread model confirmation is not per-turn snapshot-version telemetry.

No ambiguous turn is automatically retried. Requests time out after 10 seconds; turns and Live observations after 30 seconds; managed login after 180 seconds. A hung async delta consumer also times out. Close sends EOF, then SIGTERM after 100 ms, then SIGKILL after 300 ms if needed, and waits for child exit. Cancellation waits for an interrupted terminal status before closing. CLI SIGINT/SIGTERM use cancellation during text and close during other phases.

Empty dynamic tools, read-only sandboxing, and feature flags alone **do not prove zero model tools**. The source-backed environment setting is independently checked in the loaded-thread response. Server permission/tool requests, environment connections, tool items, hooks, and model reroutes fail closed. Real zero-tool execution remains an authenticated validation obligation. Raw protocol/provider/stderr diagnostics are neither printed nor persisted by the bridge.

## Managed login readiness and rejection diagnostics

The parent freshly inspected pinned `send_chatgpt_login_completion_notifications`: successful `account/login/completed` is sent **before** auth-manager reload and refresh work, followed by `account/updated`. `account/read` with `refreshToken: false` reads cached provider state. The client now subscribes to both events before login starts, retains events preceding the start response, requires a successful matching completion ID, and ignores updates preceding completion. A later update is only a readiness barrier: it has no login ID, and its nullable auth mode/plan are never treated as approval. Exactly one final account read applies the unchanged four-plan policy.

One overall login deadline covers the initial read, start response, completion, readiness and final read; it is not restarted between stages. Known login IDs are cancelled on failure using the existing bounded request path, then the child closes. Observers are disposed on success, error, timeout and transport close. Pinned generated notification schemas are checked during bridge startup. Synthetic RED exposed the premature second account read; GREEN and fake-clock triangulation cover event ordering, late start responses, failed/mismatched completion, final-read timeout and cleanup. The correction's focused auth/policy suites passed 38 tests, and the full suite passed 72. No polling, token refresh or login retry was added.

| Fixed rejection category | Meaning; no raw account data is emitted |
| --- | --- |
| `account_missing` | Null or missing response/account. |
| `non_chatgpt_account` | Recognized non-ChatGPT account kind. |
| `unsupported_plan` | Known pinned plan enum outside go/plus/pro/prolite, including the `unknown` sentinel. |
| `invalid_account_shape` | Malformed account, unrecognized kind, or malformed/unrecognized plan. |

An earlier official managed sign-in ended in `subscription_auth_required`. The prior readiness race is proven, but **its responsibility for that earlier rejection remains unresolved**. A later human attempt produced a safe subscription account projection with ephemeral storage, then failed during the text phase as described below. Sign-in does not establish inference entitlement or compatibility. No device-ceremony information is recorded here, and this correction performs no authentication retry. At that checkpoint, parent independent checks were required before another human attempt.

## Blocked activity diagnostics: no permission change

Before structured diagnostics, the parent reported `{phase: text, error: blocked_activity, category: tool}` after that successful sign-in; no text/Live result or blocking event identity was captured at that stage. A separate parent verifier's single unauthenticated start/config/ephemeral-thread check observed only `remoteControl/status/changed`, `thread/started`, and `warning` during three seconds. It observed no blocked activity, items, or MCP notices, and closed both owned children. This non-reproduction does not identify the authenticated failure or establish that any MCP notification is harmless.

The diagnostic-only correction retains every existing rejection condition, server-request denial, auth/quota gate, and teardown path. Only `blocked_activity` errors gain `activity`: a fixed method literal (or `unrecognized`), a fixed `itemType` for item started/completed, and a fixed `status` for MCP startup updates. The small literal lists come from the pinned generated `ServerNotification`, `ThreadItem`, and `McpServerStartupState` schemas; they are diagnostic labels, not permission rules. Every MCP startup state remains rejected under the existing rule.

CLI error JSON is rebuilt through a shared pure projection. Unknown method/type/status strings become fixed sentinels; payloads, names, IDs, paths, arguments, results, text, account data, arbitrary keys, and accidental error properties/cause/message/serialization hooks are never copied. No notification stream, raw stderr, or `account/updated` payload logger was added. Synthetic tests exercise the emitted projection and unchanged rejection/closure: the focused RPC suite passed 84 tests and the full suite passed 140. Native unauthenticated startup/configuration/close also passed; no authenticated reproduction was attempted. At that checkpoint, `npm run codex:smoke` remained subject to parent independent verification and renewed human authorization; the diagnostic correction requested no retry.

### Child-only Apps prevention

A later human report identified `mcpServer/startupStatus/updated` with status `starting` during the text phase after managed ChatGPT subscription login. This identifies a lifecycle event, **not a server identity or tool execution**. The child now receives `-c features.apps=false`, with strict effective-config validation through the existing startup loop. The existing `apps._default.enabled=false` remains defense in depth: per-app controls do not disable the Apps feature's compatibility-MCP registration path. Plugin/hook restrictions, empty environments, auth/quota gates, outer isolation, and every RPC/MCP denial remain unchanged; global MCP connections are untouched.

Parent-fetched pinned source at **2026-09-11T19:53:33Z** supports the intended prevention path below. It also marks `features.tool_search` Removed and ignored, so that no-op override was removed; it never disabled always-enabled tool search or changed effective permissions. No guessed replacement flag was added. Later host-extension overlays can still introduce MCP activity, so this does not promise all startup events are impossible, identify the observed server, or prove authenticated resolution. This correction passed 23 policy tests, the unchanged 84-test RPC suite, and 142 tests overall. Native unauthenticated startup passed strict effective-config validation including `features.apps=false`, then closed its child. That validated configuration, not authenticated absence of MCP startup; parent independent verification and a separately authorized human run were still required at that checkpoint.

## Historical quota rejection and correction

After the Apps change, the human reported `{"phase":"text","error":"included_usage_unavailable"}`. No raw quota payload was retained, so that attempt's failing predicate, actual quota exhaustion, and available included entitlement remain unknown. At that checkpoint there was no successful text response, inference latency, or authenticated Live result; the later success above does not diagnose the earlier rejection.

Parent inspection of the pinned [backend snapshot mapping](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/backend-client/src/client.rs) found independently nullable windows, deliberately absent supplementary spend-control metadata, and a legitimate Pro single-window fixture. The [usage reader](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/backend-client/src/client/rate_limit_resets.rs) derives ordinary permission from backend `rate_limit.allowed` using GET; the [account processor](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/app-server/src/request_processors/account_processor.rs) filters permission to matching active account/user identities. This is parent-fetched Rust evidence, not writer research or account entitlement evidence. Two parent-provided independent verifier reports support the bounded local correction above; null/missing/malformed ordinary permission still rejects.

Rejection order is deterministic: response object shape → ordinary permission → base/map/entry selection shapes → Spark identification → base bucket then applicable buckets in map enumeration order. All entry objects and their required nullable-string `normalModelSlug` are validated before applicability can exclude them. The map must be explicit null or a non-array object; unrelated metadata such as names/balances is not required or inspected. Within each selected bucket: spend → reached type → window validity → both-null absence → exhaustion. Another healthy bucket never substitutes. Spark identification failure retains `model_quota_unknown`; other quota failures retain `included_usage_unavailable` with only the following categories.

| Safe quota category | Meaning |
| --- | --- |
| `ordinary_permission_unavailable` | Null, missing or malformed ordinary permission. |
| `ordinary_permission_denied` | Literal false ordinary permission. |
| `buckets_missing_or_invalid` | Invalid response, base, map, entry or selection discriminator. |
| `spend_control_blocked` | Literal true spend control. |
| `spend_control_missing_or_invalid` | Missing or malformed spend state. |
| `reached_type_present_or_invalid` | Reached type is not explicit null. |
| `windows_missing_or_invalid` | Missing/malformed window or nonnumeric, nonfinite or negative percentage. |
| `windows_absent` | Both windows are explicit null. |
| `windows_exhausted` | A valid finite percentage is at least 100. |

The shared CLI projector allowlists only these quota categories, omitting missing/invalid/arbitrary categories without serializing attached fields or hooks. Auth/activity diagnostics and all account, plan, catalog, tier, effort, isolation and tool guards are unchanged. No account payload, identifier, percentage, balance, backend string, or raw protocol log is emitted.

A local delegation interruption delayed verification but supplied no authenticated provider evidence. Work paused without relaxing application guards or requesting another login. A separately authorized, targeted duplicate-registration repair restored RPC readiness and an actual scoped delegated read; private host configuration and internal task details are omitted. This restored orchestration, not application verification. The earlier 142-test result predates the quota correction.

Strict RED against unchanged implementation observed 33 assertion failures (27 policy, 6 projector), with 120 tests passing and no setup failure. Initial GREEN passed 153 focused tests. Triangulation and a typed test-table refactor passed 165 (59 policy, 106 RPC), covering every applicable bucket, malformed shapes, permission denial, boundary percentages, Spark/Pro preservation, safe categories and unchanged auth/activity diagnostics.

| Exact production-correction command (historical) | Observed result before fixture repair |
| --- | --- |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 test -- --run tests/codex-policy.test.ts tests/codex-rpc.test.ts` | RED exit 1: 33 failed/120 passed; GREEN exit 0: 153 passed; triangulation/refactor exit 0: 165 passed. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 test -- --run` | Exit 1: 193 passed, 7 bridge tests failed at `buckets_missing_or_invalid`. Their shared fixture omitted `normalModelSlug` and `rateLimitsByLimitId`; `tests/codex-bridge.test.ts` was outside that approved edit surface and remained unchanged. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 run typecheck` | Initially failed on heterogeneous RPC test-table inference; exit 0 after wrapping cases in typed-inferred records. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 run codex:check-isolation` | Exit 0: Codex 0.154.0, isolation/startup passed, effective configuration validated, owned child closed, auth not started. |
| `git diff --check` | Exit 0; does not inspect the untracked implementation files. |
| `git status --short` | Exit 0; pre-existing dirty/untracked candidate remains unstaged. |

### Separate synthetic bridge-fixture repair

Schema precision: generated TypeScript makes `normalModelSlug` and `rateLimitsByLimitId` nonoptional nullable members, while the generated JSON Schema permits omission. The client deliberately requires their presence. Parent inspection of the [pinned Rust account protocol](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/account.rs) found ordinary derived `Serialize` with no omission attributes on these fields; explicit null is the source-backed expected serialized form for absent values, not an observed account payload.

A subsequent bounded authorization added only `normalModelSlug: null` to the shared base bucket and `rateLimitsByLimitId: null` to its response in `tests/codex-bridge.test.ts`. These represent explicit absence under the pinned contract, not new permission. Production code, all fixture permission/percentage/spend/reached values, every existing assertion and timeout remain unchanged. Fresh focused RED reproduced seven `included_usage_unavailable` / `buckets_missing_or_invalid` failures and one passing test; adding the two fields produced eight passing tests. The earlier failures were fixture incompatibilities, not environmental exceptions.

| Exact fixture-repair verification command | Newly observed result |
| --- | --- |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 test -- --run tests/codex-bridge.test.ts` | RED exit 1: 7 failed/1 passed; GREEN exit 0: all 8 passed. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 test -- --run` | Exit 0: all 200 tests passed across 6 files. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 run typecheck` | Exit 0. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 run codex:check-isolation` | Exit 0: Codex 0.154.0, isolation/startup passed, effective configuration validated, owned child closed, auth not started. |
| `git diff --check` | Exit 0; excludes untracked content. |
| `git status --short` | Exit 0; pre-existing dirty/untracked candidate remains unstaged. |

An independent pre-R3 verifier inspected the quota gates, caller ordering, bounded diagnostics and fixture behavior, then reran the full-suite, typecheck and native-readiness commands above: all 200 tests across six files passed, typecheck was silent, and Codex 0.154.0 startup/configuration/owned-child close passed without authentication. Its `git diff --check` was silent and before/after `git status --short` listings matched; a separate parent `git diff --check` spot check was also silent. Historical RED counts and exclusive change-history claims remain writer-attributed; neither status nor tracked diffs establish unchanged untracked-file bytes.

At the pre-R3 checkpoint, all required local checks passed. Account/quota data were synthetic, while streaming/cancellation/teardown tests used real owned Node fixture subprocesses—not actual Codex inference. Authenticated text/Live evidence and full-candidate native review were still pending then. Native risk assessment returned empty output, so the quota candidate was treated as high risk and independently verified rather than exempted; the earlier `.gitignore`-only review did not cover the implementation. Later correction, review, and human-run evidence are recorded separately.

### Native-review transport-fault lifetime correction

`R3-transport-fault-lifetime`: text now retains a separate transport-fault subscription through completion and asynchronous callback draining, races faults against pending work, and disposes it on every exit. A post-completion fault rejects with the existing bounded error and closes the owned child instead of reporting success or waiting for the turn deadline. RPC denials, auth/quota/config/isolation gates, cancellation, concurrency, callback ordering and error handling remain unchanged.

Both regressions use owned synthetic fixtures: one stdout write contains start response, delta, completion and forbidden MCP activity; the other waits for completion and callback entry before faulting a never-settling callback. GREEN asserts `blocked_activity`/`tool`, child teardown, rejection within 1000 ms against a 2000 ms turn deadline, and zero retained bridge subscriptions across all ten bridge tests. No login, inference or Live operation ran in this correction. The checks below are writer-attributed; native targeted review subsequently accepted the fix independently but did not report a separate 202-test rerun.

| Exact correction verification command | Observed result |
| --- | --- |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 test -- --run tests/codex-bridge.test.ts` | RED exit 1 against unchanged production: 2 failed/8 passed (incorrect completed success; incorrect turn_timeout). GREEN/triangulation exit 0: all 10 passed, including existing streaming, cancellation, timeout, callback-failure and normal-completion cases. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 test -- --run` | Exit 0: 202 tests passed across 6 files. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 run typecheck` | Exit 0. |
| `npm --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --cache .local/batch1/npm-cache --logs-max=0 run codex:check-isolation` | Exit 0: Codex 0.154.0 isolation/startup passed, effective configuration validated, owned child closed, auth not started. |
| `git diff --check` | Exit 0; excludes untracked content. |
| `git status --short` | Exit 0; listing unchanged, candidate remains unstaged. |

The full 23-file native review approved the corrected code candidate, and exact acknowledgement completed before the later documentation update. It does not cover subsequent documentation changes. The correction measured 91 added and 12 deleted lines across four targets against the frozen candidate, within the 160-line limit. Internal writer, review and tree identifiers are omitted. Native closure supplied the independent check for that code candidate despite unavailable risk assessment. Six non-blocking native advisory findings remain deferred, not authorization to reopen them.

## Live is a separate result

For source-advertised `gpt-live-1-codex`, attempts are ordered **v3/text → v2/text → v3/audio**. `gpt-realtime-1.5` is the only other source-advertised variant and is considered only if also present in the runtime catalog. Attempts have empty API-key environments, WebSocket transport, no startup context, client-managed handoffs, and no transcript-tail handoff.

An empty start acknowledgement is not availability. Text requires an actual started event, `appendText`, and an assistant transcript completion emitted after append is sent. Text acceptance opens after the final usage check, immediately before sending append—not after its acknowledgement—so startup greetings are ignored without losing early responses. Audio, if reached, is startup negotiation only and stops without input or collected output. Every accepted session is stopped; failed stop closes the process. Requested model and requested/resolved protocol versions are labeled separately; the started event does not expose a resolved Live model, so that field remains null.

Only the known modality rejection permits another distinct attempt after a failure. API-auth requirements, other failures, or ambiguity stop all remaining attempts. The report lists untested combinations, WebRTC, existingCall, v1, audio input, audio output capture/playback, and microphone explicitly. **The WebSocket restriction is not generalized to WebRTC or existingCall.**

Known-safe compatibility causes are retained as fixed codes:

| Code | Parent-supplied pinned-source meaning; both codes observed in the latest human run |
| --- | --- |
| `text_requires_realtime_v2` | `text realtime output modality requires realtime v2`; V1/V3 text is rejected before WebSocket key acquisition. |
| `realtime_websocket_requires_api_key` | `realtime conversation requires API key auth`; the WebSocket path requires API-style credentials. No attempt is made to supply them. |

## Evidence provenance

The parent fetched official evidence starting **2026-09-11T09:33:34Z**. These are parent-supplied excerpts, not research performed by the implementation writer. The writer independently checked npm metadata and generated both TypeScript and JSON experimental schemas from the installed, isolated binary.

| Official source | Bounded evidence |
| --- | --- |
| [Latest official release](https://api.github.com/repos/openai/codex/releases/latest) | Parent observed non-prerelease `rust-v0.154.0`, published 2026-09-09T22:35:38Z. npm metadata independently returned 0.154.0. |
| [App Server docs](https://developers.openai.com/codex/app-server/) | Redirected to ChatGPT Learn; initialize/initialized, stdio JSONL, turn events, approvals, experimental protocol generation. |
| [Authentication](https://developers.openai.com/codex/auth/) | Official managed ChatGPT/device flow; ephemeral credential mode is memory-only for the process. Generated `CliAuthCredentialsStoreMode` independently includes `ephemeral`. |
| [Pinned account processor](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/app-server/src/request_processors/account_processor.rs) | Parent's later fresh source inspection: completion → auth-manager reload/refresh → account update; cached account reads do not wait for reload. Generated update schema independently confirms nullable authMode/planType and no loginId. |
| [Config reference](https://developers.openai.com/codex/config-reference/) and [pinned schema](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/core/config.schema.json) | Forced ChatGPT, credential store, feature/discovery controls; schema supports boolean `features.apps`. Effective configuration must pass the runtime check before login. |
| [Pinned feature registry](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/features/src/lib.rs) | Parent's 19:53:33Z fetch: Apps is Stable/default-enabled; `apps_enabled_for_auth` requires `enabled(Apps) && has_chatgpt_auth`. `tool_search` is Removed/ignored. |
| [Pinned config assembly](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/core/src/config/mod.rs) and [MCP runtime](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/core/src/mcp.rs) | Same parent fetch: `apps_enabled: self.features.enabled(Feature::Apps)` controls compatibility-MCP registration; false selects `remove_compatibility`. Later host overlays remain a separate path. |
| [Pinned connector discovery](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/core/src/connectors.rs) | Same parent fetch: discovery returns empty early when `!apps_enabled_for_auth`. |
| [Models](https://developers.openai.com/codex/models/) | Luna and Pro text-only Spark recommendations; not account entitlement or subscription price proof. |
| [Pinned thread protocol](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) | Empty environments disable access for turns without overrides. Generated schema independently confirms this and reports loaded-thread environments. |
| [Pinned realtime protocol](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/realtime.rs) | Text/audio enums, websocket/webrtc/existingCall, v1/v2/v3, startup-context and handoff fields. Enums do not prove compatible combinations. |
| [Pinned realtime implementation](https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/core/src/realtime_conversation.rs) | Default model constants and validation order: transport → modality configuration → **WebSocket-only** key acquisition. WebRTC/existingCall bypass that key helper. |

Parent lookup limitations: introducing-gpt-live pages returned 403; old `app-server/README.md`, `core/src/tools/spec.rs`, and flat protocol `v2.rs` locations returned 404 after moves. These failed lookups supply no compatibility evidence.

## Verification history

Real unauthenticated evidence: isolated native `codex-cli 0.154.0`, generated experimental TS/JSON schemas and required-field checks, deterministic filesystem/environment assertions, and actual `CodexBridge.start()` → strict effective CONFIG validation → owned-child close. One separately authorized metadata-only `thread/start` diagnostic also passed unchanged `assertThread`: expected model/provider/tier/effort, read-only sandbox with network disabled, user approvals, ephemeral thread, null history path, and zero environments/instruction sources. That diagnostic made no login, turn, realtime, or inference request and closed its child. Owned Node fixture subprocesses verify streaming and teardown; account/catalog/auth/Live fixtures are synthetic. None of these establishes authenticated behavior, Electron, OBS, pricing, or other transports.

A subsequent human startup failed with `config_warning` before authentication. Independent native diagnosis identified missing **inner** bubblewrap on `PATH=/bin`, not unstable features; it separately verified all 22 CONFIG entries with zero mismatches or server requests. Earlier version/schema checks never exercised bridge startup. The enhanced readiness command reproduced `config_warning` before the fix, then passed actual unauthenticated startup and close after the narrow mounts below. Warning handling remains fail-closed and unchanged.

`ldd /usr/bin/bwrap` and bounded `readlink -f` checks established this supported Linux x64 host's dependency set. The launcher mounts `/usr/bin/bwrap` read-only at `/bin/bwrap` and the following files read-only at their listed loader paths; no runtime scanner or broad `/usr`/`/lib` mount is used. Other library layouts require a separate audit, not fallback discovery.

| Runtime mount path | Purpose |
| --- | --- |
| `/lib/x86_64-linux-gnu/libselinux.so.1` | Linked SELinux support. |
| `/lib/x86_64-linux-gnu/libcap.so.2` | Linked capability support. |
| `/lib/x86_64-linux-gnu/libc.so.6` | C runtime. |
| `/lib/x86_64-linux-gnu/libpcre2-8.so.0` | Regular-expression library in the dependency closure. |
| `/lib64/ld-linux-x86-64.so.2` | ELF dynamic loader. |

The paths resolve under `/usr/lib/x86_64-linux-gnu/`; current versioned targets are `libcap.so.2.75` and `libpcre2-8.so.0.14.0`, with the remaining basenames unchanged. The kernel-provided vDSO needs no filesystem mount. The native readiness check also executes inner `bwrap --version` to verify these libraries load, without model tools or inference.

Independent parent verification passed the earlier 38 tests, typecheck, protocol generation, and isolation checks. A separate synthetic fixture then exposed pre-prompt greetings being reported as event responses. The correction gates text acceptance at append submission; regression tests cover both transcript event shapes, pre-append greetings, post-append/pre-acknowledgement responses, early realtime errors, and cleanup. This finding and correction involve no native inference or authentication.

The parent's earlier `npm run codex:smoke` exited 1 with `interactive_auth_terminal_required`, before login or upstream access. The later human run above used a human-controlled terminal and redirected only sanitized stdout, leaving stderr attached to the terminal. Do not merge or capture ceremony stderr, or bypass the TTY check.

The implementation verification procedure used the commands in [README](../README.md), then `git diff --check`, `git diff --stat`, and `git status --short`. Historical writer handoffs record exact RED/GREEN and final command results; no TDD/runtime tests were applicable or rerun for this documentation-only update. The initial npm failure came from loading `/dev/null` twice as user/global configuration; the approved correction is an empty ignored local global-config file, not a global configuration change.

The latest human-run evidence supersedes the pending-ceremony status, not the safety boundaries. Record only safe setup/text/Live JSON—not ceremony data or raw events. If effective policy, quota, catalog, auth, or isolation checks fail, report the exact safe code; do not weaken the checks or switch to API auth. Batch 1 ends with successful text and the two bounded Live limitations above; no further batch, retry, staging, commit, or deployment is authorized.
