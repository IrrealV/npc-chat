---
name: obs-browser-source
description: "Trigger: OBS overlay, Browser Source, transparency, scene lifecycle. Gate browser-only overlay compatibility checks."
---

## Activation Contract

Use for an authorized OBS Browser Source overlay or compatibility probe. Do not configure OBS or create an integration during documentation-only preparation.

## Hard Rules

- Treat Browser Source as a CEF browser, not an Electron renderer with privileged APIs. Keep Electron APIs and credentials out of the overlay.
- Treat displayed model and stream content as untrusted; render safely without executable markup.
- Do not assume OBS WebSocket is required or select a delivery architecture without approval.
- Preserve transparency intentionally; default transparent CSS does not prove the application's alpha output.

## Decision Gates

| Situation | Action |
| --- | --- |
| Local file versus URL | Confirm the authorized source and exposure before choosing. |
| Shutdown when invisible enabled | Expect page unload; verify reconstruction when visible. |
| Refresh on active scene enabled | Expect reload; verify restored display state. |

## Execution Steps

1. Recheck the official Browser Source options before the scoped implementation or probe.
2. Record OBS version/platform, source type, width, height, FPS, CSS, and the two lifecycle settings.
3. Verify readable output and alpha over contrasting backgrounds in real OBS, not only a normal browser screenshot.
4. Exercise hide/show, scene activation, and reload. Where a connection exists, check disconnection and reconnection without stale or duplicated content.

## Output Contract

Return approved source choices, changed paths, exact observations, lifecycle settings, and remaining gaps. Separate browser-only evidence from real OBS verification; never claim integration before it is exercised.

## References

- [Official Browser Source evidence](../../../docs/skills.md#obs-browser-source)
