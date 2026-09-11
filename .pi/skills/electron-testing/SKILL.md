---
name: electron-testing
description: "Trigger: Electron tests, Vitest, Playwright Electron, desktop regression. Separate unit evidence from real runtime checks."
---

## Activation Contract

Use when an authorized batch introduces executable behavior or desktop tests. Do not install tools or scaffold tests for documentation-only work.

## Hard Rules

- Choose compatible Electron, Vite, Vitest, and Playwright versions only after inspecting the authorized implementation and current documentation.
- Use strict TDD: observe the intended behavioral failure, implement the minimum fix, then exercise alternate and negative cases.
- Use Vitest for isolated logic; renderer or IPC mocks do not prove Electron security, native behavior, or OBS compatibility.
- Treat Playwright `_electron` automation as experimental. Native dialogs are not intercepted; the `nodeCliInspect` fuse can prevent launch.
- Keep sandboxing, CSP, and other production protections enabled in tests. Report platform/display blockers rather than bypassing them.

## Decision Gates

| Evidence needed | Action |
| --- | --- |
| Pure state or transformation | Prefer deterministic unit tests. |
| Preload, window, or IPC boundary | Add real Electron checks, including denied operations. |
| Overlay rendering or lifecycle | Verify separately in real OBS. |

## Execution Steps

1. Define behavior and deterministic fixtures before implementation; avoid live accounts and credentials.
2. Review Vite configuration that Vitest reads by default; use one-shot `vitest run` only when an authorized toolchain exists.
3. For Electron automation, launch the app, inspect its first window, and always close it with deterministic teardown, including failure paths.
4. Run focused checks first; run broader verification only within authorization.

## Output Contract

Return exact commands, observed RED/GREEN evidence, runtime/platform scope, teardown results, and untested cases. Mark unavailable runtime checks as not run, never passed.

## References

- [Official testing evidence and limitations](../../../docs/skills.md#electron-testing)
