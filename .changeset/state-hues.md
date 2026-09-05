---
"argus": patch
---

fix(argus): state wears the theme's colours, not literals

The operator noticed the PACS progress bar was "all green-ish, looks out of place". It was: a hardcoded `linear-gradient(90deg, #2a5, #3c6)` on a surface where every other colour is a theme token. Looking properly, there were ten such literals — feed status, PACS badges, the subway diagram's failed stop, the offline lamp, the audio pill, the attach error — each ignoring whichever LCARS scheme is active.

Worse, `--mars` was **referenced five times and defined nowhere**. Every rule using it had been silently inert: the refused-row colouring added yesterday, its strike-through tint, and the WARM-UP FAILED readout were all falling back to inherited colour rather than showing red. An undefined custom property fails quietly, which is why it looked plausible.

State hues are now declared once and derived from the theme's seven base colours, so they follow the scheme: done from daybreak, running from orange, idle a dimmed pumpkin-pie for a track where nothing has happened yet. Error is the deliberate exception, mixed toward the palette rather than taken from it, because danger must not blend into a warm scheme.

Chrome that is red *by design* rather than by state — the LCARS close pill — gets a real `--mars` token of its own, so the two meanings stop borrowing each other's colour.

No literal state colours remain. Smoke passes unedited at 63 checks.
