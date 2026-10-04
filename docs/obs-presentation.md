# Read the simulated chat in a browser or OBS

`npc:serve` runs the existing manual chat session and a loopback-only presentation server in one process. The reading panel and transparent overlay display the same sanitized conversation snapshot. They cannot send events, start inference, or access authentication details.

The session reuses the shared persisted Codex sign-in, so only the first run performs the managed device-code ceremony. Sign out explicitly with `.local/toolchains/run-npm run npc:logout -- --confirm`; see [persistent Codex authentication](codex-authentication.md).

## Start the session

Use an interactive terminal:

```sh
.local/toolchains/run-npm run --silent npc:serve -- --count 5
```

The default port is `4177`. To select another fixed port:

```sh
.local/toolchains/run-npm run --silent npc:serve -- --count 5 --port 4180
```

The port must be from 1024 through 65535. The command never falls back to another port. A busy port fails before bridge startup or sign-in.

After startup, stderr prints both local URLs:

| View | URL |
| --- | --- |
| Reading panel | `http://127.0.0.1:4177/` |
| OBS overlay | `http://127.0.0.1:4177/overlay` |

Successful generated batches remain JSON on stdout, as they do for `npc:session`. Keep stderr attached to the terminal for the managed sign-in ceremony and prompts.

## Paced presentation and terminal waiting

`npc:serve` reveals each accepted batch on one shared server-side schedule: the
first message appears immediately, and each following message appears between
1 and 3 seconds later. Both the reading panel and the overlay see the same
reveal order, with a short (about 200 ms) opacity and slide entrance on live
arrivals only. Initial connection, reconnect, and reload restore the current
visible messages silently. The terminal stays busy until the last message of
the batch is published, so wait for the next `event>` prompt before entering
another event; the JSON line on stdout is not paced.

`/exit` still works at a ready prompt. `Ctrl+C` or `SIGTERM` interrupts an
ongoing presentation immediately: remaining messages are not revealed and no
new inference starts. An end-of-file input lets the accepted batch finish
presenting before the session exits.

## Add the views to OBS

Use the printed loopback URLs. Do not replace `127.0.0.1` with a LAN address.

### Reading panel as a custom browser dock

When the installed OBS build supports custom browser docks:

1. Open the OBS custom browser dock configuration.
2. Add the printed reading panel URL.
3. Choose a narrow but readable dock width.
4. Keep the dock local to the machine running `npc:serve`.

The panel shows connection and empty states. It retains up to 100 messages and does not force the scroll position to the bottom when an operator is reading older messages.

### Overlay as a Browser Source

1. Add a Browser Source to the intended scene.
2. Select URL input and enter the printed `/overlay` URL.
3. Choose dimensions and FPS appropriate for the scene.
4. Leave the page background transparent. Add custom CSS only if the scene requires it.
5. Decide whether to enable **Shutdown source when not visible** and **Refresh browser when scene becomes active**.

The overlay displays only the latest 10 retained messages and aligns them to the bottom. Reloading or reconnecting restores the currently visible snapshot silently, so it does not replay generation or re-animate old messages.

The overlay treats the browser viewport as a fixed, bottom-anchored frame. The page and the space around each message stay transparent so the scene shows through, while each message sits in its own opaque ink-blue backplate with a fine full border, restrained rounded corners, and comfortable padding. Every backplate sizes to its content and is bounded by the available width, so short messages stay compact and long messages wrap inside the frame instead of overflowing it. The overlay uses a larger overlay-only type scale (`clamp(24px, 3.5vw, 32px)`, about 28 px at the confirmed 800 px wide source) and renders the participant name inline before the message with a colon separator. Long names and messages wrap instead of truncating. When retained history is taller than the frame, older messages clip above the frame while the newest stay visible; the ten-message data cap is still the only data limit, and the reading panel is unchanged.

## Security and data limits

The server:

- listens only on `127.0.0.1`;
- accepts only exact GET routes;
- validates the exact local Host, any supplied Origin, and Fetch Metadata;
- sends strict CSP, no-store, nosniff, and same-origin resource policy headers;
- provides no permissive CORS response;
- retains at most 100 sanitized username and message pairs in memory;
- allows at most eight simultaneous event streams;
- closes slow streams instead of building an unbounded queue;
- stores no history on disk.

These checks reduce browser exposure, but they are not authentication against another process already running on the same computer. Browser views receive no raw event input, provider or model provenance, persona roster, authentication data, or provider error details.

Stopping the terminal session closes the presentation server and active streams. Browser disconnects do not stop the terminal session or retry inference.

## Verification limits

Automated tests exercise real Node loopback HTTP and SSE with synthetic terminal and bridge fixtures. The delivered client script is exercised in a synthetic DOM and VM harness for snapshot replacement and safe text rendering.

Those checks do not prove behavior in a real browser, CEF, or OBS installation. Before relying on the overlay, record and manually verify:

- OBS version, platform, and package source;
- source type, dimensions, FPS, and any custom CSS;
- readability of the opaque message backplates over white, black, and mixed scene content;
- outside-of-bubble transparency, so the scene shows around each message;
- overlay name/message separation, type size, and long-message wrapping inside the available width;
- newest-message visibility when history is taller than the frame;
- hide and show behavior with shutdown-when-hidden both enabled and disabled;
- scene activation behavior with refresh-on-activation both enabled and disabled;
- reload and reconnect without duplicated, stale, or re-animated messages;
- gradual one-by-one arrivals with the short entrance animation in both views;
- reduced-motion behavior where the platform exposes that preference;
- terminal busy state between events and immediate `Ctrl+C` interruption;
- clean disconnect after `npc:serve` exits.
