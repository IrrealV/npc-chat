# npc-chat

Batch 1 ends with **one successful authenticated text turn and a bounded Live WebSocket limitation**. This is a local TypeScript Codex App Server compatibility bridge, not an Electron application. Desktop UI, stream capture, audio, vision, OBS, other providers, and deployment remain out of scope.

The repository now also includes a [human-operated manual-event chat command](docs/manual-chat-batch.md): one event, managed sign-in, one text call, and a validated multi-user message array in the same process. Its tests are synthetic and do not establish native readiness, real-provider JSON compliance, or language quality. It is not the microphone/OBS dock/overlay MVP.

After completing the guide's human-run protocol and isolation prerequisites, run it with interactive stderr:

```sh
.local/toolchains/run-npm run --silent npc:chat -- --event "The streamer misses the last jump" --count 5
```

Keep stderr on the terminal for the managed sign-in ceremony; do not redirect or capture it. `--silent` keeps npm's command preamble out of the successful JSON stdout.

For several related manual events under one login, use the separate [continuous session command](docs/manual-chat-session.md):

```sh
.local/toolchains/run-npm run --silent npc:session -- --count 5
```

To show that same continuous session in a local reading panel and transparent OBS overlay, run:

```sh
.local/toolchains/run-npm run --silent npc:serve -- --count 5
```

It binds only to `127.0.0.1:4177` by default. Use `--port <1024-65535>` for another fixed port. The panel retains 100 messages and the overlay displays the latest 10. See [OBS presentation setup, security limits, and manual verification](docs/obs-presentation.md).

All three product commands reuse one app-owned Codex sign-in across normal shutdown and restart: the first run performs the managed device-code ceremony, and later runs skip it. Codex's file storage is plaintext `auth.json` protected only by OS permissions, outside the repository and separate from personal Codex login. Sign out explicitly with `.local/toolchains/run-npm run npc:logout -- --confirm`. See [persistent Codex authentication](docs/codex-authentication.md).

The presentation tests use Node loopback HTTP/SSE and a synthetic DOM harness. They do not establish real browser, CEF, or OBS compatibility. A human must verify transparency, readability, scene lifecycle settings, reload behavior, and disconnect behavior in the target OBS installation.

## Run the isolated checks

Requires Linux x64, Node 22.23.2, npm 10.9.8, and working unprivileged bubblewrap. There is no unsandboxed fallback.

```sh
mkdir -p .local/batch1
touch .local/batch1/npm-globalrc
npm install --ignore-scripts --no-audit --no-fund --cache .local/batch1/npm-cache --userconfig /dev/null --globalconfig .local/batch1/npm-globalrc --logs-max=0
npm test -- --run
npm run typecheck
npm run codex:protocol
npm run codex:check-isolation
```

Keep the local npm configuration file empty. Do not reuse personal configuration or authentication.

## Human-authorized compatibility run

**Human-run smoke completed one text turn** with `gpt-5.6-luna`; the two attempted Live text/WebSocket combinations returned bounded `not_available` results. The actual command was:

```sh
npm run --silent codex:smoke > .local/batch1/authenticated-smoke.jsonl
```

It performed official managed ChatGPT device sign-in, one Spanish text turn, and separately labeled experimental Live checks in the **same process**. That historical smoke run used ephemeral authentication; the product commands above now reuse an app-owned persisted profile. Stdout went only to the sanitized JSONL report, so no terminal stdout was expected; the ceremony stayed on terminal stderr. Never merge or capture ceremony stderr, or share device codes. Separate `codex:login`, `codex:probe`, and `codex:live` scripts each start fresh and require their own sign-in.

Project context is available in the [sanitized memory snapshot and restore guide](docs/memory/README.md).

Sign-in does not prove model entitlement, included pricing, or Live compatibility. See [Batch 1 boundaries, evidence, and verification](docs/batch-1.md). Read [AGENTS.md](AGENTS.md) and [local skills](docs/skills.md) before another batch. No repository license has been selected.
