# @fnndsc/chell

## 5.0.1

### Patch Changes

- Updated dependencies [d69b086]
- Updated dependencies [d69b086]
  - @fnndsc/brasa@0.2.0
  - @fnndsc/chili@3.4.0
  - @fnndsc/calypso@0.3.1

## 5.0.0

### Major Changes

- c824000: chell is now the CLI surface over the new `@fnndsc/brasa` engine package. The shell engine (parser, dispatch, pipes, builtins, session, output) was lifted into brasa; chell keeps the readline REPL, terminal rendering, and prompt themes.

  Breaking: the `calypso` daemon binary is no longer provided by chell — it now ships with `@fnndsc/calypso`. Install that package to run the daemon (`chell --daemon` continues to work). Prompt themes now render per-surface from a pushed context rather than as a server-rendered string.

### Patch Changes

- Updated dependencies [c824000]
  - @fnndsc/calypso@0.3.0

## 4.4.0

### Minor Changes

- 55d2dab: Capture bridge for legacy printing builtins: `CaptureSink` (data and err buffered, status passed live so spinners stay visible) and `printingHandler_wrap`, which runs a printing handler under capture and returns its output as an envelope with status derived from the exit code. The resource-group commands (feed, plugin, compute, tag, group, pluginmeta, plugininstance, workflow, files, links, dirs, context, parametersofplugin, and aliases) now flow through the bridge: envelope semantics, identical bytes, typed models deferred until a structural consumer exists.
- aa81b0a: Add the error stream to the envelope contract and convert the first fs builtins. `CommandEnvelope` gains `renderedErr` (printable stderr text, ANSI permitted), keeping the error stream separate from pipeable data; `envelope_error` accepts it as a third argument; the structured `errors` field is machine-facing and no longer presented by delivery. chell's `OutputSink` gains `err_write` (stdout sink routes to stderr; capture sink passes through uncaptured, matching today's pipe semantics). Builtins converted: `cd`, `mkdir`, `touch` (models `fs.cwd`, `fs.mkdir`, `fs.touch`), rendered and error-stream bytes identical to the previous behavior.
- 2f2f6d3: `calypso` is now its own command. It is `chell --daemon` under a dedicated name — hosting one engine over a loopback WebSocket for remote surfaces to attach to — and shares chell's entire connection surface: the `user@url` shorthand, `--user`, and the hidden password prompt all work exactly as they do for `chell` (bare `calypso` inherits the saved session; `calypso rudolphpienaar@http://cube/api/v1/` prompts and connects at startup). Attach a surface with `chell --remote`. The DEP0169 warning suppression shared by both entry points moved into `core/warnings.ts`, and `chell_start` now accepts an argv override so the `calypso` entry can force daemon mode without duplicating the bootstrap.
- 30a3e1e: Interactivity over the wire: a builtin that prompts during a remote command now reaches the surface running it. The contract gains a `prompt` request (daemon→surface, with hidden-input support) and a `promptAnswer` reply (surface→daemon). The daemon serializes execution across the whole session so a mid-command prompt has one unambiguous target, and exposes an input broker (`prompt_current`) the host wires into its `Surface`; the `chell --daemon` launcher installs a surface whose `prompt` delegates to it, so `repl_question` (passwords, confirmations, the plugin admin flow, the prompt configurator) works over the wire unchanged. The `chell --remote` client answers incoming prompt requests from its own terminal (hidden when asked) and replies. Completion already round-trips from the earlier daemon work; the themed pushed prompt string and client-side pipe-segment execution remain follow-ups.
- 93e604f: Run pipeline segments on the surface, never on the daemon host. Segment execution becomes a surface capability: the `Surface` gains `pipeSegments` (a capability flag) and a `pipeSegment(command, input)` method. The local CLI runs segments in-process exactly as before (byte-identical); the daemon's surface routes them over the wire (new `pipe`/`pipeResult` messages, base64 for the bytes) to the surface running the command, which runs them on its own machine — so a pipeline like `ls | grep foo` never spawns anything on the daemon host, closing that attack surface. A surface without the capability (a browser) fails such pipelines with a clear message. Completes the interactivity work: prompts, completion, the pushed prompt string, and pipe segments all now work over the wire.
- f492dd9: Push the themed prompt string to remote surfaces. Only the daemon holds the session context the prompt renders, so it renders the prompt and pushes it (a new `promptline` message) to every surface on attach and after each command — the context may have changed. A surface prints what it receives, so prompt themes look identical whether the session is local or remote. chell factors prompt rendering into a shared `sessionPrompt_render` used by both the local REPL and the daemon's `promptProvider`; the `chell --remote` client renders the latest pushed prompt (falling back to a fixed string until the first push), replacing the placeholder prompt it showed before.
- 7cee888: The surface owns the local editor, so `edit` works over the wire. The `Surface` gains a `localEdit(content, extension)` method (resolving the flag-only deferral from the prompt-capability work): the CLI surface backs it with the temp-file-and-`$EDITOR` mechanics that used to live in the `edit` builtin, and the daemon backs it by routing to the surface running the command (new `edit`/`editResult` messages + an `edit_current` broker) so the operator's own editor opens, never one on the daemon host. The `edit` builtin no longer touches processes or temp files for editing — it fetches the file, hands the content to `surface.localEdit`, and uploads the result; `chell --remote` opens the client's editor. A surface without the `localEdit` capability (a browser) fails `edit` with a clear message.
- 8bb7ec5: Add `chell --daemon` and `chell --remote`: the same REPL now drives either an in-process engine or a CALYPSO daemon over the wire. `chell --daemon` hosts the connected engine behind a daemon (forcing color on, silencing the daemon's own console, and advertising its URL + attach token in a user-only-readable discovery file for same-user attach); `chell --remote` discovers that daemon and attaches as a surface. The transport swap is a new `RemoteEngine` that implements the engine interface over the WebSocket contract and delivers received envelopes to the sink exactly as the in-process engine delivers live, so the REPL is unchanged — proving the sibling-surfaces topology (two remote shells on one daemon each see the other's commands via the session bus). This is the first place chell depends on `@fnndsc/calypso`.
- 2099ff6: Make the error stack async-context aware and drain it per command. cumin's `errorStack` gains `scope_run` (run work against an isolated stack), `checkpoint_mark`, and `checkpoint_drain`: fire-and-forget background work (topology warm-up, background cache refresh) now runs inside its own scope so its error traffic cannot land in a concurrent foreground command's drain window. chell's dispatch checkpoints the stack before each command and drains anything pushed above the checkpoint into the envelope's `errors` field, escalating status to `error` when a genuine error was left on the stack — a reliable per-command failure signal that also retires the exit-code-delta status heuristic's blind spot (a later failing batch segment no longer reads `ok`). CLI behavior is byte-identical.
- 60cbd8e: Extract the engine facade (`engine_create`, `line_execute`, `line_complete`, `ChellEngine`): line-level orchestration — shell escape, semicolon batching, redirects, pipes — now lives in `core/engine.ts` and yields one `CommandEnvelope` per executed command, while output continues to reach the active sink live. The REPL shrinks to a thin host (read line → engine → sink), dispatch gains envelope-producing execution (`command_dispatchEnvelope`, `command_executeToEnvelope`, `redirect_execute`, `pipe_execute`), and the unknown-command chili fallback now runs through the capture bridge so it too produces envelopes. Observable CLI behavior is byte-identical.
- 363bff0: Bridge second batch of printing builtins into envelopes (ls, tree, du, help, proc, logout, cubepath, query). Unbridge plugin: its add flow prompts for admin credentials through readline, which capture would make invisible; it stays a direct printer until the prompt capability lands with the engine facade.
- d302511: Introduce the output sink seam (`OutputSink`, `StdoutSink`, `BufferSink`, `envelope_deliver`, `envelopeHandler_wrap`): command output now leaves the engine through a host-installed sink instead of builtins assuming a terminal. The REPL installs a stdout sink, preserving CLI behavior exactly. First builtins converted to envelope returns (`pwd`, `whoami`, `whereami`), registered in the dispatch table through the compatibility wrapper and exposed raw via the new `ENVELOPE_HANDLERS` registry for envelope-aware hosts. See docs/calypso.adoc.
- 99c65e1: Convert timing, physicalmode, and debug builtins to envelope returns (typed models `sys.timing`, `sys.physicalMode`, `sys.debug`; rendered text byte-identical). Rename the sink channel methods to the project's RPN convention: `OutputSink.data_write` and `OutputSink.status_write`.
- b90a9cc: Pipes and redirects consume envelopes. The capture seam now feeds pipe chains and redirect targets from envelope-speaking commands' rendered text with ANSI stripped (plain pipes, the documented deviation from historical escape-byte leakage), passes error-stream text live to stderr, and still captures direct stdout writers such as binary cat. Legacy printing commands keep the old capture path unchanged.
- 5a2c448: Make interactivity a declared surface capability. A new surface seam (`core/surface.ts`) is the input-side counterpart to the output sink: a host installs a `Surface` that declares what interaction it can offer (`hiddenInput`, `localEdit`, `tty`) and backs prompting, and a builtin can require a capability via `capability_require` and fail with a clear message instead of hanging on a standard input that is not there. The CLI host installs a readline-backed surface (`core/cliSurface.ts`) — persistent on the REPL's interface, one-shot in execute/script modes — preserving the single-readline, no-echo-leak discipline. `question.ts`'s `repl_question` / `repl_questionHidden` now delegate to the active surface (salsa's admin-prompt flow and the prompt builtin are unchanged), and the `edit` builtin declares its need for `localEdit`. CLI behavior is byte-identical.
- 657311f: Convert cat to envelope returns (model `fs.cat` with per-file outcomes; text content buffered into rendered, binary content streamed with backpressure as before, auto-detection notice emitted live on the err channel so it precedes the bytes). Route the spinner through the sink's status channel: byte-identical on a terminal today, and positioned so transient frames never enter envelopes, pipes, or remote data streams.
- 2f2f6d3: Add a `version` command inside the shell. Typing `version` at the chell prompt (or `chell -c version`, and over a CALYPSO daemon via `chell --remote`) now prints the same stack report as `chell --version` — chell plus the chili/salsa/cumin layers — as a typed `sys.version` envelope, instead of falling through to chili as an unknown command. The version-report logic that both `--version` and the boot panel already shared moved into `core/version.ts` so the new command reuses it rather than duplicating the package.json loading.
- afde0e8: Convert cp, mv, and rm builtins to envelope returns (models `fs.cp`, `fs.mv`, `fs.rm` with per-target outcomes; rendered and error-stream bytes identical). Interactive `rm -i` streams live through the sink so confirmation prompts stay in sequence; non-interactive output is buffered into the envelope.

### Patch Changes

- 2f2f6d3: Fix `exit` from a remote surface tearing down the whole CALYPSO daemon. The REPL now treats `exit` as a shell-quit at the surface layer (closing readline) instead of forwarding it to the engine; for a `chell --remote` surface this detaches the client while the daemon — and any other attached surfaces — keep running. Previously `exit` reached the daemon's dispatch and called `process.exit`, killing every surface. Local interactive `exit` is unchanged apart from now printing the same goodbye line as Ctrl-D.
- Updated dependencies [aa81b0a]
- Updated dependencies [f8e0233]
- Updated dependencies [30a3e1e]
- Updated dependencies [93e604f]
- Updated dependencies [f492dd9]
- Updated dependencies [7cee888]
- Updated dependencies [e293d97]
- Updated dependencies [38df08f]
- Updated dependencies [2099ff6]
- Updated dependencies [c47ff22]
  - @fnndsc/cumin@3.5.0
  - @fnndsc/calypso@0.2.0

## 4.3.2

### Patch Changes

- Example accession numbers in help text replaced with clearly fake values.
- Updated dependencies
  - @fnndsc/salsa@3.2.6

## 4.3.1

### Patch Changes

- PACS query polish: a zero-match query completes in seconds through the "no studies found" path instead of spamming per-poll errors and riding the 60s timeout; browse/pull hints are suppressed when nothing matched; the spinner erases to end-of-line so shorter status messages no longer show the tail of longer ones.

## 4.3.0

### Minor Changes

- chell expands `$NAME` / `${NAME}` environment references in command arguments, making scripts parameterizable. `--version` now reports the chili/salsa/cumin versions in use. Fixes: `pull` re-pull of a series (query title collision), `pull` with a query expression (CWD was corrupting the first DICOM key), silent `query` failures now print the error stack, and `-e` aborts `-f` scripts with a non-zero exit when a command fails. New `exemplars/` reference programs and scripts (repo only, not packaged).

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fnndsc/chili@3.3.0
  - @fnndsc/cumin@3.4.0

## 4.2.12

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
- Updated dependencies
  - @fnndsc/cumin@3.3.0
  - @fnndsc/salsa@3.2.5
  - @fnndsc/chili@3.2.6
