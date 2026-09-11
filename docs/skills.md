# Local skills: inventory and evidence

Batch 0 adds four original, project-authored guidance skills. They encode future gates, not an implemented application. No third-party skill code was downloaded or vendored, no vendor endorsement is claimed, and no repository license has been chosen.

## Portable inventory

Cloning this repository includes these files; no installer or dependency command is needed:

| Skill path | Triggers |
| --- | --- |
| [`.pi/skills/electron-security/SKILL.md`](../.pi/skills/electron-security/SKILL.md) | Electron security, preload, IPC, renderer permissions |
| [`.pi/skills/electron-testing/SKILL.md`](../.pi/skills/electron-testing/SKILL.md) | Electron tests, Vitest, Playwright Electron, desktop regression |
| [`.pi/skills/obs-browser-source/SKILL.md`](../.pi/skills/obs-browser-source/SKILL.md) | OBS overlay, Browser Source, transparency, scene lifecycle |
| [`.pi/skills/codex-app-server/SKILL.md`](../.pi/skills/codex-app-server/SKILL.md) | Codex App Server, ChatGPT subscription integration, approval events |

Pi documents automatic `.pi/skills/` discovery **subject to project trust**. No settings changes are needed for the conventional path. Only the registry scanner was observed finding all four local entries; Pi trust, skill advertisement, and full skill loading were not tested. Do not bypass trust to load these files.

### Existing environment guidance

- Reuse the existing user-level `frontend-design` skill unchanged. It is not included on clone; do not copy a replacement into this project.
- Optional user-level `openai-docs` provides general official-documentation lookup, not an App Server integration contract. The nested file at `~/.codex/skills/.system/openai-docs/SKILL.md` may exist without an index row: check exact-file availability, then pass its resolved path when relevant. It is not included on clone; do not duplicate or copy it. Neither external skill is an additional Batch 0 install.
- The prior scout inspected seven registry roots and common alternate roots. A bounded settings/package-root check found no additional matching domain coverage. One configured package declared an absent skills directory. This was not an exhaustive marketplace search or a third-party skill qualification exercise.

### Machine-local index

`.atl/skill-registry.md` is ignored and machine-specific, not part of the portable inventory. The initial manual 28-row index was subsequently replaced by a runtime-generated index. During correction, 14 rows were observed: the ten original user entries and four local skills. This is a snapshot, not a guaranteed count.

The installed registry extension scans immediate child `SKILL.md` files under fixed roots, prefers project entries by name, and overwrites the index/cache on regeneration rather than merging manual additions. Session startup can refresh before the UI guard; the process responsible for this replacement was not established. Manual extra rows are not durable, and nested external skills can remain absent from the index.

For future skill changes, use `/skill-registry:refresh` if available, then confirm the four exact local entries and baseline user entries. Do not re-add transient rows or alter configuration, trust, or cache to preserve them. Check optional external skill availability separately and pass exact selected paths, not generated rule summaries. Indexing neither installs skills nor establishes Pi trust, advertisement, full loading, or runtime compatibility.

## Official evidence

The parent preparation session fetched and read these mutable official pages on **2026-09-10 UTC**. Separate redirected GET checks returned HTTP 200 at **2026-09-10T23:51:55Z**. These are dated documentation observations, not immutable vendor versions or runtime validation. Recheck documentation against selected versions before implementation.

### Electron security

- [Security checklist](https://www.electronjs.org/docs/latest/tutorial/security) — final URL unchanged. Checked Node integration, context isolation, sandboxing, CSP, `webSecurity`, permissions, navigation, and IPC sender validation.
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) — final URL unchanged. Enabled by default since Electron 12, but insufficient alone; expose individual filtered bridge methods, not raw IPC. TypeScript bridge declarations are supported.

### Electron testing

- [Vitest guide](https://vitest.dev/guide/) — final URL unchanged. Vite-powered, reads Vite configuration by default, and supports one-shot `vitest run`. Version constraints exist; no versions or tools are selected here.
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron) — final URL unchanged. `_electron` is experimental; launch, first-window access, and close are documented. The `nodeCliInspect` fuse can block launch, and native dialogs are not intercepted. Mocks cannot establish real Electron or OBS behavior.

### OBS Browser Source

- [Browser Source](https://obsproject.com/kb/browser-source) — final URL unchanged. Checked CEF, local-file/URL input, dimensions/FPS, default transparent CSS, unload when invisible, and reload on scene activation. Real lifecycle and alpha checks remain future work; OBS WebSocket is not presumed necessary.

### Codex App Server

- [Original App Server URL](https://developers.openai.com/codex/app-server/) redirected to [the final App Server page](https://learn.chatgpt.com/docs/app-server). Checked authentication/history/approvals/events, default stdio JSONL, omitted `jsonrpc` header, initialize/initialized ordering, version-specific schema generation, and server requests. App Server/WebSocket support is experimental and not production-supported; non-loopback listeners can lack authentication unless configured.
- [Original authentication URL](https://developers.openai.com/codex/auth/) redirected to [the final authentication page](https://learn.chatgpt.com/docs/auth). ChatGPT sign-in and usage-based API-key access are distinct; cached authentication files or OS keyrings contain sensitive credentials. Do not inspect or export them. These docs do **not** validate this project's subscription entitlement or compatibility. Codex was not run or authenticated in Batch 0.

## Verification limits

Batch 0 checks cover documentation structure, public file inventory, local links, ignore behavior, whitespace, snapshot hashes, and heuristic secret patterns. The repeatable standard-library checker is local and ignored at `.atl/batch0-check.py`; it is not shipped on clone. Exact results belong in the batch handoff, not an invented application-test badge.

There is no runnable application or test suite. Heuristic scanning can miss secrets and raise false positives; it is not a security guarantee. Pi trust and full skill loading, Electron protections, OBS rendering, and Codex compatibility remain untested and require separately authorized work. See [AGENTS.md](../AGENTS.md) before proceeding.
