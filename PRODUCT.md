# Product

## Register

product

## Users

The person streaming. They run this tool themselves in a terminal next to their
broadcast software, enter a manual event after something happens on stream, and
read the generated simulated chat either in a local panel or as a transparent
overlay in their scene. They are technically comfortable but focused on the
stream while the tool runs, so the interface must be understandable at a glance.

## Product Purpose

Generate an honest simulated chat conversation from one manual event per
generation, and present it in two loopback views: a reading panel and an OBS
overlay. Each accepted event produces one validated batch; nothing is sent,
inferred, or automated without the operator's explicit terminal input. Success
is a readable, believable chat display that the operator fully controls, with
clear terminal feedback and no hidden activity.

## Brand Personality

Familiar, discreet, readable. The chat should feel like the Twitch/YouTube chat
format viewers already know, without claiming affiliation with those platforms
or any live-platform integration. The tool stays out of the way: it serves the
conversation, it never performs for attention.

## Anti-references

- Overloaded dashboards with dense chrome, panels, and metrics.
- Decorative clutter: gradients, badges, ornaments that add noise to chat rows.
- Animation that competes with the content: bounces, long choreography, or
  motion that redraws unchanged history.

## Design Principles

1. One event, one visible outcome: every operator action maps to a single
   bounded, observable result, and states are communicated honestly.
2. Chat content first: the conversation is the interface; chrome and motion
   support reading and never outrank it.
3. Transparency over cleverness: simulated conversation stays clearly
   simulated; the terminal shows what was generated and when presentation is
   busy; no hidden retries, queues, or inference.
4. Operator control: the terminal owns pacing decisions (busy until presented,
   immediate interruption); views never invent behavior the operator did not
   choose.
5. Readability in the real context: narrow docks, transparent overlay
   backgrounds, and text that survives contrast over arbitrary scenes.

## Accessibility & Inclusion

- Readability in narrow dock widths, with wrapping that never clips text.
- States (connecting, live, reconnecting, empty) understandable without
  depending on color alone.
- Respect reduced motion: entrance animation is brief and suppressed when the
  viewer or platform requests reduced motion.
- No conformance level is claimed; no full audit has been performed.

## Current and Future Scope

Current: manual terminal events, one model generation per event, localhost
panel plus transparent overlay, shared paced presentation. Future ambitions
explicitly out of current scope: microphone input and OBS PROGRAM imagery
capture. No real participant impersonation, no account connections, no claims
about naturalness or platform acceptance.
