# @fnndsc/calypso

## 0.3.6

### Patch Changes

- Updated dependencies [a1f6694]
- Updated dependencies [01ab743]
- Updated dependencies [b8ae635]
- Updated dependencies [ca63e8b]
  - @fnndsc/cumin@3.7.0
  - @fnndsc/brasa@0.7.0

## 0.3.5

### Patch Changes

- Updated dependencies [e5a30f7]
  - @fnndsc/brasa@0.6.0

## 0.3.4

### Patch Changes

- Updated dependencies [c2087d0]
  - @fnndsc/brasa@0.5.0

## 0.3.3

### Patch Changes

- Updated dependencies [512e14f]
- Updated dependencies [880d37a]
- Updated dependencies [e43f42a]
  - @fnndsc/brasa@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [a0d3df5]
  - @fnndsc/brasa@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [d69b086]
  - @fnndsc/brasa@0.2.0

## 0.3.0

### Minor Changes

- c824000: calypso is now a self-contained session daemon. It gains the `calypso` binary (create a brasa engine, restore a saved session, host it over WebSocket) and depends on the new `@fnndsc/brasa` engine package.

  Breaking (allowed under 0.x): the package is now ESM-only (was CommonJS), and the `promptline` wire message carries a prompt `context` for the surface to theme, rather than a pre-rendered `text` string.

## 0.2.0

### Minor Changes

- f8e0233: Add the CALYPSO daemon: a WebSocket host over one engine. `CalypsoDaemon` binds the loopback interface only and hosts a single engine, which it accepts through a structural `HostedEngine` interface (chell's `ChellEngine` satisfies it) rather than importing chell — keeping calypso engine-agnostic and free of a package cycle. A surface attaches with the contract version and a random attach token (generated at startup, written to a user-readable 0600 file for same-user discovery, compared in constant time via `timingSafeEqual`); once attached it drives the engine with `execute` and `complete` messages and receives `result` and completion replies, with execution serialized per connection. CUBE credentials never cross the wire — the hosted engine holds its own session. This slice returns each command's final result envelopes; live output streaming and the cross-surface session bus build on it.
- 30a3e1e: Interactivity over the wire: a builtin that prompts during a remote command now reaches the surface running it. The contract gains a `prompt` request (daemon→surface, with hidden-input support) and a `promptAnswer` reply (surface→daemon). The daemon serializes execution across the whole session so a mid-command prompt has one unambiguous target, and exposes an input broker (`prompt_current`) the host wires into its `Surface`; the `chell --daemon` launcher installs a surface whose `prompt` delegates to it, so `repl_question` (passwords, confirmations, the plugin admin flow, the prompt configurator) works over the wire unchanged. The `chell --remote` client answers incoming prompt requests from its own terminal (hidden when asked) and replies. Completion already round-trips from the earlier daemon work; the themed pushed prompt string and client-side pipe-segment execution remain follow-ups.
- 93e604f: Run pipeline segments on the surface, never on the daemon host. Segment execution becomes a surface capability: the `Surface` gains `pipeSegments` (a capability flag) and a `pipeSegment(command, input)` method. The local CLI runs segments in-process exactly as before (byte-identical); the daemon's surface routes them over the wire (new `pipe`/`pipeResult` messages, base64 for the bytes) to the surface running the command, which runs them on its own machine — so a pipeline like `ls | grep foo` never spawns anything on the daemon host, closing that attack surface. A surface without the capability (a browser) fails such pipelines with a clear message. Completes the interactivity work: prompts, completion, the pushed prompt string, and pipe segments all now work over the wire.
- f492dd9: Push the themed prompt string to remote surfaces. Only the daemon holds the session context the prompt renders, so it renders the prompt and pushes it (a new `promptline` message) to every surface on attach and after each command — the context may have changed. A surface prints what it receives, so prompt themes look identical whether the session is local or remote. chell factors prompt rendering into a shared `sessionPrompt_render` used by both the local REPL and the daemon's `promptProvider`; the `chell --remote` client renders the latest pushed prompt (falling back to a fixed string until the first push), replacing the placeholder prompt it showed before.
- 7cee888: The surface owns the local editor, so `edit` works over the wire. The `Surface` gains a `localEdit(content, extension)` method (resolving the flag-only deferral from the prompt-capability work): the CLI surface backs it with the temp-file-and-`$EDITOR` mechanics that used to live in the `edit` builtin, and the daemon backs it by routing to the surface running the command (new `edit`/`editResult` messages + an `edit_current` broker) so the operator's own editor opens, never one on the daemon host. The `edit` builtin no longer touches processes or temp files for editing — it fetches the file, hands the content to `surface.localEdit`, and uploads the result; `chell --remote` opens the client's editor. A surface without the `localEdit` capability (a browser) fails `edit` with a clear message.
- e293d97: Add the session bus to the daemon. All attached surfaces share one session: each command's result envelopes are broadcast to the _other_ attached surfaces as `session {surface, envelope}` events (tagged with the surface that produced them), so a command issued in one surface is immediately visible in the rest — the originator receives its own correlated `result`, not a duplicate broadcast. A bounded scrollback ring buffer (default 200 envelopes, configurable via `scrollbackSize`) is replayed to an attaching surface so it does not join blind; scrollback is presentation rather than truth, so a daemon restart correctly loses it. Surfaces are dropped from the bus when their socket closes.
- 38df08f: Introduce `@fnndsc/calypso`, the fifth mise package: the session daemon that will host the chell engine and serve it to surfaces over a WebSocket. This first slice is the wire contract — the typed protocol schemas and boundary validation every message crosses. Messages are two direction-keyed discriminated unions (surface→daemon: attach/execute/complete; daemon→surface: attached/result/complete/output/session/error), defined as zod schemas that are the single source of truth and from which the message types are inferred. A `commandEnvelopeSchema` validates cumin's `CommandEnvelope` on the wire, kept in step with cumin's type by a compile-time guard so the contract cannot silently drift. Boundary validation rejects structural violations, tolerates unknown additive fields, and never throws; the contract version is carried in the attach handshake and refused on mismatch. See docs/calypso.adoc for the governing design.

### Patch Changes

- Updated dependencies [aa81b0a]
- Updated dependencies [2099ff6]
- Updated dependencies [c47ff22]
  - @fnndsc/cumin@3.5.0
