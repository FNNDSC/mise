# @fnndsc/brasa

## 0.8.0

### Minor Changes

- 8ac7ef9: Add `feed diagram --signalflow <feedId>` — emits a feed's DAG as a **SignalFlow YAML
  document to stdout**, composed with pipes rather than rendered in place:

  ```
  feed diagram --signalflow 1669 | signalflow -            # ASCII
  feed diagram --signalflow 1669 | signalflow - -o x.svg   # SVG
  feed diagram --signalflow 1669 > feed-1669.yaml          # keep it
  ```

  It builds the graph cache-first, collapses isomorphic siblings into named `×N` chips, and
  encodes topological-join edges via SignalFlow's node-reuse mechanism. mise emits the
  representation only — no renderer is invoked, discovered, or bundled — so there is nothing
  to install for the command itself; rendering is the user's own `signalflow`. `--signalflow`
  names the dialect, leaving room for further emitters (`--json`, `--dot`, …).

## 0.7.0

### Minor Changes

- b8ae635: `feed tree` now collapses isomorphic sibling subtrees by default. Structurally-identical
  branches merge into one `×N` template node showing a proportional status bar, per-category
  counts (`97✓ 2⋯ 1✗`), and the ids of any non-done members (error first) so failures stay
  addressable. Collapsed groups use a double-line connector to signal multiplicity. Pass
  `--flat` to draw every node individually.
- ca63e8b: Add `feed tree <feedId>` — renders a feed's plugin-instance DAG as an annotated text
  tree. The anchor tree is drawn with box-drawing connectors; topological-join (`ts`) nodes
  are annotated inline with the extra sources they merge (`⋈ joins ...`). Supports
  `--focus <id>` to scope to a subtree and `--max-nodes <n>` to cap output (0 = all). The
  envelope carries a typed `feed.tree` FeedGraph model.

### Patch Changes

- 01ab743: `feed tree` now builds the DAG **cache-first** from the warm ProcCache instead of
  re-crawling the feed on every call. It reuses already-loaded topology, fetches feed
  metadata only when missing or a placeholder, refreshes volatile status cheaply (one
  feed-scoped list call, active nodes only) when reusing a warm cache, and resolves join
  edges lazily. New salsa exports: `feedGraphData_ensure`, `feedMeta_ensure`,
  `feedInstances_ensureLoaded`, `feedStatus_refresh`.
- Updated dependencies [a1f6694]
- Updated dependencies [01ab743]
  - @fnndsc/cumin@3.7.0
  - @fnndsc/salsa@3.4.0

## 0.6.1

### Patch Changes

- 0d358c5: /proc now caches settled job status. A finished plugin instance
  (`finishedSuccessfully`, `finishedWithError`, `cancelled`) never changes, so its
  status is kept permanently once observed. Consequences:

  - Listing a fully-finished feed under `/proc/jobs` is instant — no status calls.
  - Live status for active feeds is refreshed with a single feed-scoped list call
    (the list response already carries `status`) instead of one detail fetch per node.
  - Reading a settled instance's `status` returns the cached value without an API call.

- Updated dependencies [0d358c5]
  - @fnndsc/cumin@3.6.0
  - @fnndsc/salsa@3.3.0

## 0.6.0

### Minor Changes

- e5a30f7: Add `date` and `cal` builtins, in the spirit of their UNIX namesakes and fully self-contained (pure computation — no host binary, no subprocess). `date` prints the current date/time with the familiar default format, `-u` for UTC, and `+FORMAT` strftime-style format strings (it reports the time only, never sets the clock). `cal` prints a month (`cal`), a whole year (`cal <year>`), or a specific month (`cal <month> <year>`), with today highlighted. Both return their output in an envelope through the sink, so they work identically local, over a CALYPSO daemon, and in the standalone binary.

## 0.5.0

### Minor Changes

- c2087d0: Add a `fortune` builtin — the classic UNIX fortune cookie, as a shell builtin. It prints a random fortune and is fully self-contained: the content is bundled (vendored from the traditional fortune-mod datfiles, classic BSD `fortune` material), so it needs no host `fortune` binary and no datfiles on disk, and behaves identically in a local shell, over a CALYPSO daemon, and in the standalone binary. Output travels in an envelope through the sink like every other command. Regenerate the bundled set with `scripts/fortunes_generate.mjs`.

## 0.4.0

### Minor Changes

- 880d37a: `chell --version` reported brasa's version in place of chell's: the version module moved into brasa during the engine split but still read its own `package.json` as "chell", so it printed brasa's number. It now resolves every package by name (reading brasa's own directly) and reports the full stack — chell, brasa, chili, salsa, cumin, calypso — with versions aligned in a column. A new `chell --info` flag prints a role-grouped table (surfaces / engine / layers) of each package, its full name, and version. The version report, the `--info` table, and the boot panel all draw from a single source of truth in brasa (`stackInfo_get`), and the standalone binary inlines every stack version at build time.
- e43f42a: Delegating an unknown chell command to chili no longer stalls or floods the terminal with context-init errors when the current directory is a pure-VFS path (`/proc`, `/net`, ...). chili now registers its file-group and plugin-context commands without resolving any ChRIS context — each controller is created lazily, only when a command's action runs — so an unrelated command (or a directory that is not a ChRIS folder) pays no network cost and produces no setup-time error wall. chili also exports `commandNames_get()`, a cheap network-free listing of its top-level commands. In brasa, the "delegating to chili" notice is now emitted on the live sink before chili runs, so it appears ahead of chili's output instead of after it; and a command chili does not know (a typo, a host program) is reported as `command not found` without delegating at all.

### Patch Changes

- 512e14f: Fix `<command> --help` leaking to a daemon's terminal instead of reaching the surface. The `--help` flag path printed help through `console.log`, which on a CALYPSO daemon landed on the daemon's own terminal — and returned an empty envelope, so a remote surface saw nothing. Help now travels in an envelope through the sink like every other command output, so `--help` reaches the surface that asked for it and never prints on the daemon. This removes the last console-based path in the help flow (`help_show`).
- Updated dependencies [e43f42a]
  - @fnndsc/chili@3.6.0

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
