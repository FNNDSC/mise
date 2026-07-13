# @fnndsc/brasa

## 0.3.0

### Minor Changes

- a0d3df5: The engine no longer intercepts the console anywhere. The pipe/redirect `output_capture` monkeypatch is deleted: pipes now capture through a `PipeCaptureSink` scoped over the (re-activated) `AsyncLocalStorage` sink scope, ANSI-stripping text writes and keeping binary writes (a raw `cat` of a DICOM file) byte-for-byte. `chiliCommand_run` drives chili through its `run_capture` seam and returns an envelope, so the pacs passthroughs and the unknown-command fallback are envelope-based. The remaining print-direct builtins are converted: `store`, `upload`, `download`, `connect`, `edit` return envelopes, while the streaming commands `pull`, `pipeline`, and `pacs` emit incremental output through the sink so it streams live to a terminal or daemon and is captured in a pipe.

### Patch Changes

- Updated dependencies [a0d3df5]
  - @fnndsc/chili@3.5.0

## 0.2.0

### Minor Changes

- d69b086: Every printing builtin now returns a `CommandEnvelope` instead of writing to the console. `files`/`links`/`dirs`, `feed`, `plugin`, and `parametersofplugin` were the last holdouts; with them converted, the per-invocation console monkeypatch (`printingHandler_wrap`, which hijacked `console.log`/`console.error`/`process.stdout.write` to capture a builtin's output) is deleted, along with the `LiveEnvelopeOutputSink` marker that only served it.

  Behavioural notes: unknown subcommands of these resource commands now return a clear error envelope instead of spawning a chili subprocess, and `search` is handled natively via `list --search`. The unknown-_command_ fallback still delegates to chili, now over the same print-direct path as the other unconverted handlers.

### Patch Changes

- Updated dependencies [d69b086]
  - @fnndsc/chili@3.4.0
