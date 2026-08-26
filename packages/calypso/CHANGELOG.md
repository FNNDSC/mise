# @fnndsc/calypso

## 0.6.0

### Minor Changes

- 0ad04f2: The engine can now hand raw file bytes to a hosting daemon: brasa's `BrasaEngine` gains an optional `file_read(filePath)` that resolves a ChRIS VFS path to a `Buffer` through chili's binary cat. Calypso's daemon exposes it as a token-gated `/vfs?path=&token=` HTTP route with extension-derived content types, letting a web surface render images and other binary content that a text transcript cannot carry.
- 1928d4b: The daemon now rides an explicit HTTP server: WebSocket upgrades carry the session contract unchanged, and plain GETs serve a configured static web root (the built ARGUS surface), discovered from `CALYPSO_WEB_ROOT` or a monorepo checkout's `apps/argus/dist`. The launcher prints the browser URL with the attach token. A new `@fnndsc/calypso/protocol` subpath exports the browser-safe wire contract (schemas, validation, version) without server-side dependencies.

### Patch Changes

- Updated dependencies [0ad04f2]
  - @fnndsc/brasa@0.12.0

## 0.5.1

### Patch Changes

- Updated dependencies [14f8ee8]
- Updated dependencies [69b0617]
- Updated dependencies [7ed8e1c]
- Updated dependencies [7dc3bca]
  - @fnndsc/cumin@3.11.0
  - @fnndsc/brasa@0.11.0

## 0.5.0

### Minor Changes

- 67377a3: Unify the five correlation-id request/reply implementations onto one `RequestBroker`. The daemon's four surface-delegated brokers (prompt, pipeline segment, host shell, edit) and the remote client's own pending-request map previously each reimplemented the id/pending/close lifecycle with divergent correctness; all five now share one class that uniformly guarantees origin-validated settles (no surface can answer another surface's prompt), close-listener removal on settle (no per-request listener leak), and rejection when the origin disconnects. The protocol gains optional `promptError` and `editError` messages (additive, no version bump) so a surface can report a failed or impossible prompt or edit. Behavior change on the remote surface: a client without a prompt, pipe, or edit handler now reports the inability as an error instead of silently answering empty, passing pipe input through unchanged, or returning an unchanged "successful" edit.
- b2f5ad3: Greet every surface with the stack's identity. Builds now record the short git hash they were produced from (`dist/buildinfo.json`, written by the new `scripts/buildinfo.mjs` build step), and brasa exposes it through `buildHash_get` alongside `welcomeLine_build`/`welcomeLine_compose`, which render a banner of the form `ChELL Executes Layered Logic, v 5.3.0 (886f09). Welcome.` An interactive chell session prints the banner and a short fortune at boot, the calypso daemon announces its banner plus an aligned version line for every stack layer (chell, brasa, chili, salsa, cumin, calypso) when it starts listening, and the attach handshake gains an optional `stack` field carrying all six versions and the build hash, so a remote surface banners the daemon's full reported stack rather than its local install's. `fortune_random` is exported for reuse, with an optional line-count bound so banners favour short cookies.

### Patch Changes

- 8ec8a4b: Add explicit, command-scoped CUBE elevation with `sudo <command>`. The active surface collects an administrator identity and hidden password; a temporary CUBE client runs only the nested command, then the normal session is restored. Group membership and plugin registration now suggest a copyable `sudo` rerun after an authorization failure, and plugin registration no longer owns a separate interactive admin prompt.
- d0ac04f: Preserve failure causes and tighten cache contracts. Errors that were replaced by generic messages now carry their real cause: controller and handler creation failures name the underlying error instead of "no ChRIS context", `cat` shows the actual fetch failure, docker command failures surface stderr detail, context-set errors actually print, settings load/save failures are announced instead of silently using defaults or losing changes, unreadable berth and discovery files are named instead of reading as "no daemon", token-file read errors are distinguished from the logged-out state, and resource deletes report why they failed. Every remaining deliberate error absorption now carries a dated adjudication comment. Cache contracts: the PACS provider's decoded-query cache caches settled results only and is size-bounded; the object-context factory gains an eviction hook (`objContext_evict`) for deleted plugin or feed ids; `mv` and `cp` invalidate the whole affected listing subtree; and a new PACS query invalidates the cached `/net/pacs/queries` listing so it appears in the next `ls` immediately.
- 3cde784: Publish refreshed prompt context before completing a remote command so
  state-changing commands cannot leave ChELL displaying a stale prompt.
- ac69b3e: Run ChELL shell escapes on the originating surface, including remote clients,
  instead of exposing the CALYPSO daemon host process and filesystem.
- Updated dependencies [2e60785]
- Updated dependencies [66bc932]
- Updated dependencies [8ec8a4b]
- Updated dependencies [d0ac04f]
- Updated dependencies [886f09c]
- Updated dependencies [50e9bb1]
- Updated dependencies [d0ac04f]
- Updated dependencies [22db63f]
- Updated dependencies [ac69b3e]
- Updated dependencies [0e92d4d]
- Updated dependencies [590a943]
- Updated dependencies [fa81126]
- Updated dependencies [b2f5ad3]
  - @fnndsc/brasa@0.10.0
  - @fnndsc/cumin@3.9.0

## 0.4.5

### Patch Changes

- Carry semantic Pipeline-inspection progress from a hosted Brasa engine to
  the remote surface that issued the command.
- Updated dependencies
  - @fnndsc/brasa@0.9.8

## 0.4.4

### Patch Changes

- Carry cold, cached-refresh, and failed `/proc` lifecycle state through the
  CALYPSO prompt contract; reorder p10k segments and render distinct lifecycle
  clues for local and remote surfaces.
- Updated dependencies
  - @fnndsc/cumin@3.8.2
  - @fnndsc/brasa@0.9.3

## 0.4.3

### Patch Changes

- 6f0833a: Release the coordinated ChELL stack with deterministic `/proc` topology progress, complete visible-feed indexing, safe warm-up query gating, remote one-shot command completion, and refreshed daemon documentation.
- Updated dependencies [6f0833a]
  - @fnndsc/cumin@3.8.1
  - @fnndsc/brasa@0.9.2

## 0.4.2

### Patch Changes

- 71a6cd4: Route a pipeline executable's bare `--signalflow` flag to SignalFlow diagram output and provide contextual help for dynamic pipeline commands. Keep final-segment redirection on the originating surface, propagate remote pipe-segment failures back to the engine, and prevent remote command errors from terminating the interactive ChELL client. Daemon mode now reports shared startup cache warming and publishes its listening berth only after engine readiness. Consistently document `signalflow -` for stdin rendering.
- Updated dependencies [71a6cd4]
  - @fnndsc/brasa@0.9.1

## 0.4.1

### Patch Changes

- Updated dependencies [e630f79]
- Updated dependencies [e630f79]
  - @fnndsc/brasa@0.9.0
  - @fnndsc/cumin@3.8.0

## 0.4.0

### Minor Changes

- 50d0680: Run several CALYPSO daemons on one machine — one per CUBE identity — driven by the
  same `--daemon` / `--remote` verbs:

  ```
  chell --daemon me@https://cube/api/v1/ -p pw       # my daemon
  chell --daemon them@https://cube/api/v1/ -p pw     # their daemon (isolated)
  chell --remote me@https://cube/api/v1/             # attach to MY daemon
  chell --remote                                     # sole berth attaches; picker if several
  ```

  Daemon discovery is now keyed by identity: each daemon advertises a **berth**
  (`{ identity, url, token }`) under `$XDG_RUNTIME_DIR/calypso/` (falling back to the
  system temp dir), `0700` on the directory and `0600` on each file. `--daemon` refuses
  to start a second daemon for an identity that is already live, pointing at the
  running one instead. Bare `--remote` attaches the sole live berth, offers an
  interactive picker when several are running, and requires an explicit
  `<user>@<url>` in a non-interactive context.

  All berth lookup goes through a `BerthResolver` seam (`resolve`, `list`), with a
  `LocalBerthResolver` over the runtime files and an injected liveness probe that
  reaps berths whose daemon has gone. The seam leaves room for a future network
  resolver without any surface change.

## 0.3.7

### Patch Changes

- Updated dependencies [8ac7ef9]
  - @fnndsc/brasa@0.8.0

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
