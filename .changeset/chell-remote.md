---
"@fnndsc/chell": minor
---

Add `chell --daemon` and `chell --remote`: the same REPL now drives either an in-process engine or a CALYPSO daemon over the wire. `chell --daemon` hosts the connected engine behind a daemon (forcing color on, silencing the daemon's own console, and advertising its URL + attach token in a user-only-readable discovery file for same-user attach); `chell --remote` discovers that daemon and attaches as a surface. The transport swap is a new `RemoteEngine` that implements the engine interface over the WebSocket contract and delivers received envelopes to the sink exactly as the in-process engine delivers live, so the REPL is unchanged — proving the sibling-surfaces topology (two remote shells on one daemon each see the other's commands via the session bus). This is the first place chell depends on `@fnndsc/calypso`.
