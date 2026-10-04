# Run a continuous manual chat session

Use `npc:session` to enter several related events after one managed sign-in. The process keeps at most three validated turns in memory, sends one request at a time, and prints one validated JSON line per successful turn.

This remains a human-operated compatibility command. Synthetic tests do not establish native readiness, account entitlement, provider JSON compliance, language quality, or latency.

The managed sign-in persists across restarts: only the first run performs the device-code ceremony. Closing the command is not logout; use `.local/toolchains/run-npm run npc:logout -- --confirm` to sign out. See [persistent Codex authentication](codex-authentication.md).

## Before you run it

Complete the prerequisite checks in [the one-shot manual chat guide](manual-chat-batch.md#human-prerequisite-checks). Keep stdin and stderr attached to the terminal. Do not redirect, pipe, tee, log, or share stderr or the device code.

## Start the session

```sh
.local/toolchains/run-npm run --silent npc:session -- --count 5
```

`--count` defaults to 5 and accepts integers from 2 through 10. `--help` works without a TTY and does not start Codex:

```sh
.local/toolchains/run-npm run npc:session -- --help
```

After sign-in, type one event at each `event>` prompt. Blank lines are ignored. Enter `/exit` only at a ready prompt to finish normally. Other slash commands are rejected with a safe hint.

## Session behavior

- The process starts and signs in once, then makes one text call per accepted event.
- Input completed while a generation is busy is discarded rather than queued. Wait for the next `event>` prompt before entering another event.
- EOF at a ready prompt exits immediately. EOF during generation lets the accepted turn finish and publish, then exits.
- `Ctrl+C` or `SIGTERM` cancels the whole session at any point. There is no cancel-and-resume command.
- A generation or authentication error ends the session without retry or relogin because cancellation and bridge failures may close the transport.
- Invalid local input may be corrected at the next prompt without calling the provider.

Each successful stdout line is a JSON object containing only validated messages and bounded provenance. Earlier successful lines remain published if a later turn fails. Raw events, partial responses, account details, terminal controls, and raw error causes are not written to stdout.

## Context limits

The bridge creates a fresh provider thread for every turn, so continuity is explicit application context rather than implicit provider memory.

The session retains defensive copies of at most three prior validated turns. Separately, it retains up to eight normalized participant-to-profile associations for the process lifetime. A participant's first validated, non-cancelled appearance receives only the shared style; after that successful turn, identities are assigned compact complementary profiles in deterministic first-seen order. Associations stay stable and are never rotated or evicted. Additional identities remain allowed under the shared style without an individual profile.

Profiles describe conversational tendencies, not biography or memories. The prompt treats participant names as escaped JSON data and keeps profile guidance separate from model output. Profile instructions can encourage stable voices but do not guarantee semantic or vocal compliance.

The fully escaped prompt remains limited to 4,000 characters. Shared style and every stored profile are fixed overhead, reducing the space available to the current event and history. The session evicts only whole oldest history turns; it never drops stored profiles or truncates the current event. If the event plus fixed overhead cannot fit, the event is rejected locally before inference. CLI preflight and generation use the same session-owned history, profiles, count, and budget rules.

When history is included, at least one returned username must match a participant from that included history after the existing trim and case-insensitive normalization. A persona roster alone does not require a participant to return after their history has been evicted. New participants are still allowed. Missing returners, malformed output, partial output, and interrupted output fail once without repair or retry and change neither history nor profiles.

## Human quality comparison

Run this separately after the synthetic checks, using one continuous session and these four events in order:

1. `The streamer misses the last jump and falls.`
2. `The streamer cautiously retries the same jump.`
3. `The streamer clears the jump but dies on landing.`
4. `The streamer asks chat to be kinder and ease off.`

Compare the four actual outputs for distinct recurring voices, natural fragments, uneven emoji and joke density, direct participation, action-focused teasing, and an appropriate reduction in teasing after the fourth event. Also check for invented memories, narrator language, synchronized assistant apologies, forced catchphrases, and implausible nickname patterns. Do not treat synthetic tests or prompt instructions as a quality pass; record the observed outputs and make the human judgment separately.

## Synthetic verification

```sh
.local/toolchains/run-npm test -- --run tests/codex-session.test.ts tests/codex-session-cli.test.ts tests/codex-chat.test.ts tests/codex-chat-cli.test.ts
```

These tests use deterministic fakes and Node streams. They do not run native Codex, authenticate, perform inference, or prove provider quality.
