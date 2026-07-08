---
"@fnndsc/calypso": minor
---

Add the CALYPSO daemon: a WebSocket host over one engine. `CalypsoDaemon` binds the loopback interface only and hosts a single engine, which it accepts through a structural `HostedEngine` interface (chell's `ChellEngine` satisfies it) rather than importing chell — keeping calypso engine-agnostic and free of a package cycle. A surface attaches with the contract version and a random attach token (generated at startup, written to a user-readable 0600 file for same-user discovery, compared in constant time via `timingSafeEqual`); once attached it drives the engine with `execute` and `complete` messages and receives `result` and completion replies, with execution serialized per connection. CUBE credentials never cross the wire — the hosted engine holds its own session. This slice returns each command's final result envelopes; live output streaming and the cross-surface session bus build on it.
