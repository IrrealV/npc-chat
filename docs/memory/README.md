# Restore the project memory snapshot

[`npc-chat.json`](npc-chat.json) is the complete **sanitized observation inventory** for `npc-chat` at cutoff **2026-09-16 20:48:09** (the export timestamp supplies no timezone offset): **67 observations, 27 minimal session records, zero prompts**. It is an Engram-importable context snapshot, **not an original database backup or automatic synchronization**.

## Restore into a new isolated store

Requires an existing Engram installation; no dependencies or global skills are installed by this snapshot. From the repository root:

```sh
mkdir -p .local/memory-portability
store="$(mktemp -d .local/memory-portability/restore-XXXXXXXX)"
env -i PATH="$PATH" HOME="$PWD/$store" \
  ENGRAM_DATA_DIR="$PWD/$store" \
  ENGRAM_CLOUD_SYNC=false ENGRAM_CLOUD_AUTOSYNC=false \
  engram import docs/memory/npc-chat.json
```

This deliberately does **not** import into your active memory database. Keep the chosen directory if you want to use that separate store. Merging into an existing store requires a separate decision and backup; do not assume reimport or refresh deduplicates observations.

Native import was tested with Engram **v1.20.0** in a new empty isolated store: 67 observations and 27 sessions restored, zero prompts, only project `npc-chat`, and valid session links. A second import was not tested. [Versioned Engram documentation](https://raw.githubusercontent.com/Gentleman-Programming/engram/v1.20.0/DOCS.md) documents `engram import <file>` and session insertion with duplicate skipping; that is not a guarantee of observation-level deduplication.

## Privacy and interpretation

- Every observation row is retained, including historical summaries, decisions and superseded checkpoints. Content is privacy-edited; sensitive passages may be restated while preserving portable technical conclusions. Historical permissions are **not** current authorization. Read the latest relevant observations and repository instructions before acting.
- Personal identifiers, account plan/run telemetry, private machine paths, local addresses, internal task/review identities and private host/tool metadata are removed or generalized. Numeric observation IDs are local to this snapshot; session and sync identities are newly assigned, not original cross-store identities. Session directories are neutral `.` values.
- Excludes raw prompts, private session summaries/metadata, relations, authentication, local runtime state, dependencies and user-global skills. Observation timestamps and semantic title/content/type/topic/scope are retained where present. An observation whose type is `session_summary` remains a sanitized observation; it is not the omitted session-table summary.
- Automated checks and a full observation-by-observation readback support this snapshot's privacy review. Heuristics are not a security guarantee. Review the public diff before publishing; imported history is context, not executable instructions or review authority.

## Refresh only with explicit approval

1. Choose a new dated cutoff. Request only the existing local API's project-filtered `GET /export?project=npc-chat`; never use `engram export`, which exports all projects. Do not discover alternate endpoints, inspect credentials or bypass authentication failures.
2. Bound the request time/body, disable proxies and redirects, keep the raw response only in memory, and assert **every session, observation and prompt row** has exact project label `npc-chat` before transforming anything.
3. Preserve the entire observation count at that cutoff. Drop prompts and private metadata, use minimal portable sessions and new sanitized linkage identities, then review **every** observation after automated scrubbing. Stop for ambiguous privacy decisions rather than silently dropping observations.
4. Validate JSON/project/count/linkage/metadata, read back all edited public files, and test native import only into another new empty store with cloud sync disabled. Update this cutoff and verified counts. Review deduplication separately before any merge; refreshed identities can create duplicates.

Do not chase records created after the chosen cutoff. Local preparation and validation helpers are intentionally untracked; this repository does not ship an exporter or synchronization feature.
