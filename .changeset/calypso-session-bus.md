---
"@fnndsc/calypso": minor
---

Add the session bus to the daemon. All attached surfaces share one session: each command's result envelopes are broadcast to the *other* attached surfaces as `session {surface, envelope}` events (tagged with the surface that produced them), so a command issued in one surface is immediately visible in the rest — the originator receives its own correlated `result`, not a duplicate broadcast. A bounded scrollback ring buffer (default 200 envelopes, configurable via `scrollbackSize`) is replayed to an attaching surface so it does not join blind; scrollback is presentation rather than truth, so a daemon restart correctly loses it. Surfaces are dropped from the bus when their socket closes.
