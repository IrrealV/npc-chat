# Agent working agreement

## Authorization comes first

- Work only inside the current batch's approved edit surfaces. Stop after each batch and return evidence before starting another.
- Batch 0 authorizes documentation, local skills, and minimal repository hygiene only: no app, scaffold, dependencies, CI, or integration probes.
- Do not change global configuration, model routing, MCP connections, authentication, or project trust. Preserve every required permission decision.
- Follow the effective Gentle Pi / Gentle AI rules; this file does not replace their review policy or delegation routing. Use one scoped writer when those rules require delegation; do not create competing write threads.
- Leave staging, commits, remotes, and GitHub operations to the authorized parent/owner. Do not infer permission from a successful check.

## Evidence and hygiene

- Report exact verification commands and observed results, including failures and blockers. Never invent a test pass.
- Apply strict TDD once executable behavior and tests exist: observe RED, implement GREEN, then triangulate and refactor with evidence. Documentation checks do not prove runtime behavior.
- Treat this as a public repository: never read, copy, log, or commit credentials, tokens, personal data, or private machine paths. Ignore rules and heuristic scans are not security guarantees.
- Write technical artifacts in English unless explicitly authorized otherwise.

## Skills

- Consult [docs/skills.md](docs/skills.md) and load matching local `SKILL.md` files before relevant work.
- Reuse the existing user-level `frontend-design` skill when available; do not vendor a duplicate. It is not included in clones.
- Pi discovers `.pi/skills/` subject to project trust. Do not change settings or trust to force discovery; report availability honestly.
- Keep the machine-local `.atl/skill-registry.md` index ignored. Refresh it after skill changes, preserve unrelated entries, and pass exact selected paths rather than generated rule summaries.
