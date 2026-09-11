---
name: codex-app-server
description: "Trigger: Codex App Server, ChatGPT subscription integration, approval events. Gate isolated compatibility probes and protocol handling."
---

## Activation Contract

Use for explicitly authorized App Server compatibility work. Do not run Codex, authenticate, install it, or choose transport architecture during Batch 0.

## Hard Rules

- Keep ChatGPT subscription sign-in distinct from usage-based API-key access. Documentation does not validate this project's intended use, account entitlement, or compatibility.
- Treat cached authentication and keyring credentials as passwords: never scrape, copy, log, commit, or share them; never change global authentication.
- Preserve user decisions for server-issued tool, file, and command permission requests. Never auto-approve.
- Do not retry ambiguous mutating requests blindly; reconcile observed state first.
- Treat App Server and its WebSocket support as experimental, not production-supported. Non-loopback listeners may be unauthenticated unless configured; do not expose one implicitly.

## Decision Gates

| Situation | Action |
| --- | --- |
| First compatibility experiment | Request a minimal isolated local probe with explicit scope and stop conditions. |
| Unknown protocol or account support | Recheck current official documentation; report unvalidated assumptions. |

## Execution Steps

1. After authorization, record the installed version and inspect its generated protocol schema; do not assume mutable docs match it.
2. Account for default stdio JSONL framing and JSON-RPC-like messages without a `jsonrpc` header. Send `initialize` once per connection, then the `initialized` notification before other requests.
3. Handle streamed thread, turn, and item events plus server requests; preserve IDs, ordering, completion/error states, and approval decisions.
4. Bound the probe, redact diagnostics, and report cancellation, disconnect, and ambiguous-outcome behavior before proposing integration.

## Output Contract

Return authorization scope, version, redacted protocol observations, exact checks, and unresolved compatibility or approval gaps. Never infer production readiness or subscription entitlement from sign-in alone.

## References

- [Official App Server and authentication evidence](../../../docs/skills.md#codex-app-server)
