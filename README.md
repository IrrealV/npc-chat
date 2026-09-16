# npc-chat

Batch 1 ends with **one successful authenticated text turn and a bounded Live WebSocket limitation**. This is a local TypeScript Codex App Server compatibility bridge, not an Electron application. Desktop UI, stream capture, audio, vision, OBS, other providers, and deployment remain out of scope; no next batch is authorized.

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

It performed official managed ChatGPT device sign-in, one Spanish text turn, and separately labeled experimental Live checks in the **same process**. Authentication was ephemeral. Stdout went only to the sanitized JSONL report, so no terminal stdout was expected; the ceremony stayed on terminal stderr. Never merge or capture ceremony stderr, or share device codes. Separate `codex:login`, `codex:probe`, and `codex:live` scripts each start fresh and require their own sign-in.

Sign-in does not prove model entitlement, included pricing, or Live compatibility. See [Batch 1 boundaries, evidence, and verification](docs/batch-1.md). Read [AGENTS.md](AGENTS.md) and [local skills](docs/skills.md) before another batch. No repository license has been selected.
