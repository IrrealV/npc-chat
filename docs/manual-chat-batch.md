# Generate one manual chat batch

Use `npc:chat` to enter one event, complete managed ChatGPT device sign-in, and print one validated JSON batch. The command owns startup, authentication, one text call, and cleanup in the same process.

This is a human-operated compatibility command, not an OBS/UI flow. The synthetic tests do not prove current native isolation, account entitlement, provider JSON compliance, language quality, or latency.

## Persistent sign-in

This command reuses one app-owned Codex sign-in across normal shutdown and restart. The first run performs the managed device-code ceremony; later runs skip it. Codex's file storage is plaintext `auth.json` protected only by OS permissions, outside the repository and separate from personal Codex login. Closing the command is not logout. Sign out explicitly with `.local/toolchains/run-npm run npc:logout -- --confirm`; see [persistent Codex authentication](codex-authentication.md).

## Human prerequisite checks

Run each step yourself, separately and in this order. Stop if any step fails. These commands were **not** executed as part of the CLI implementation.

1. Confirm the pinned binary is present without reading credentials:

   ```sh
   test -x node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex
   ```

2. Generate and validate the pinned protocol schemas:

   ```sh
   .local/toolchains/run-npm run codex:protocol
   ```

3. Confirm the generated login schemas now exist:

   ```sh
   test -f .local/batch1/schema-0.154.0-json/v2/AccountLoginCompletedNotification.json
   test -f .local/batch1/schema-0.154.0-json/v2/AccountUpdatedNotification.json
   ```

4. Validate local isolation on this machine:

   ```sh
   .local/toolchains/run-npm run codex:check-isolation
   ```

A successful historical probe does not replace these current checks. The command requires Linux x64, Node 22.23.2, npm 10.9.8, and functioning unprivileged bubblewrap; there is no unsandboxed fallback.

## Run the command

Keep stderr attached to the interactive terminal. It is the only destination for the managed sign-in URL/code and safe diagnostics. Do not redirect, pipe, tee, log, or share stderr or the device code.

```sh
.local/toolchains/run-npm run --silent npc:chat -- --event "The streamer misses the last jump" --count 5
```

Portable equivalent when the required Node/npm versions are already active:

```sh
npm run --silent npc:chat -- --event "The streamer misses the last jump" --count 5
```

`--count` is optional and defaults to 5; accepted values are integers from 2 through 10. Use `--help` alone for usage without requiring a TTY or starting Codex:

```sh
.local/toolchains/run-npm run npc:chat -- --help
```

Use `--silent` for an authenticated run when stdout must contain only the success JSON record. Ordinary `npm run npc:chat ...` writes npm's command preamble to stdout before the program output.

## Output and safety

On success, stdout receives one JSON object with validated `messages` plus model, status, Codex version, service tier, effort, and timing provenance. It does not include the raw event or account record. Errors use bounded JSON codes on stderr and a nonzero exit status; raw provider errors and causes are not printed.

The event is quoted as untrusted prompt data. Returned usernames and messages are still untrusted plain text: a future renderer must use safe text APIs rather than HTML insertion.

Signals stop the command without printing a batch. During authentication, cancellation closes the owned transport because `CodexBridge.login` has no `AbortSignal` parameter. During generation, the signal is forwarded to `CodexBridge.text`. Cleanup removes signal listeners and closes the owned bridge on every started path.

## Library contract

`generateManualChatBatch` remains available for callers that already own a started, authenticated bridge. It performs exactly one `text()` call, validates the exact requested count and strict message shape, rejects partial/interrupted output, and preserves bounded provenance. It does not retry, repair output, call Live, change models, or weaken bridge policy.

The complete escaped prompt is checked against the 4,000-character bridge limit before startup in the CLI. Shared instructions ask for casual Spain Spanish among colleagues: varied fragments, occasional laughter, action-focused teasing, warmth, and respect for requests to ease off. They explicitly avoid uniform assistant apologies, narrator voice, constant punchlines or emoji, forced misspellings, catchphrases, slurs, and default insults. These are model instructions, not validated guarantees of voice quality.

One-shot generation has no persistent persona registry. Every participant receives only the shared style because there is no validated earlier appearance in that call. Session-only individual profiles are described in the session guide.

Responses are bounded to 64,000 characters. Usernames are nonblank and at most 32 Unicode code points; messages are nonblank and at most 200; at least two normalized fictional usernames are required.

## Synthetic verification

```sh
.local/toolchains/run-npm test -- --run tests/codex-chat-cli.test.ts tests/codex-chat.test.ts
```

These tests use deterministic fakes and an owned local Node fixture. They never invoke real Codex, authenticate, perform inference, or establish native readiness.
