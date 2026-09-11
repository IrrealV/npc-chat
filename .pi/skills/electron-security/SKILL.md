---
name: electron-security
description: "Trigger: Electron security, preload, IPC, renderer permissions. Gate desktop trust boundaries before implementation."
---

## Activation Contract

Use for Electron windows, preload bridges, IPC, permissions, or navigation changes. Do not treat this guidance as an implemented security boundary.

## Hard Rules

- Treat model responses, chat, live-stream data, and remote pages as untrusted.
- Disable Node integration for remote content; require context isolation, renderer sandboxing, restrictive CSP, and enabled `webSecurity`.
- Expose narrow, purpose-specific bridge methods, not raw `ipcRenderer`, generic channel dispatch, filesystem, or shell access. Validate arguments and IPC senders; isolation alone is insufficient.
- Allowlist navigation and window creation. Grant only explicitly required permissions; keep credentials outside renderer and overlay content.
- Never weaken these protections to make development or tests pass.

## Decision Gates

| Situation | Action |
| --- | --- |
| New privileged operation | Define the caller, validated payload, and minimum capability first. |
| Unknown content origin or permission | Stop for a scoped decision; do not allow broadly. |

## Execution Steps

1. Recheck official guidance and the selected Electron version before an authorized implementation.
2. Map each untrusted input to its privileged boundary; review window settings, navigation, permissions, and bridge methods.
3. Pair authorized changes with rejection tests and real Electron checks; declare typed `Window` bridge interfaces for TypeScript.

## Output Contract

Return changed paths, boundary decisions, exact verification evidence, rejected cases, and unresolved risks. Do not claim mocks prove isolation.

## References

- [Official security and context-isolation evidence](../../../docs/skills.md#electron-security)
