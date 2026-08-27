# Structured progress contract

This note records the scoped design for issue #70: structured progress over the
CALYPSO daemon wire for `pull`, `upload`, and `download`.

Issue #221 extended it to cover *all* status output. Indeterminate work — a
PACS query, a directory scan, a cache warm-up — now announces itself as
`operation: "task"`, `kind: "inspection"`, `phase: "working"`, with no counts,
and closes with `phase: "complete"`. Nothing writes terminal escapes to the
sink any more; `scripts/wire-escapes.mjs` holds that count at zero.

Two consequences worth knowing before adding a producer. First, only state
changes are announced: animation frames and elapsed counters belong to the
renderer, so a wait of any length costs the wire the same two events. Second,
every enum on the progress message degrades rather than rejects: an unknown
`operation` reads as `task`, `phase` as `working`, `status` as `unknown`, and
`kind` and `unit` as absent. A dropped message is invisible; a generic
indicator is not.

## Rule: a new enum value ships with a fallback

`safeParse` fails the whole message on one unknown enum value, and a failed
parse drops it silently. So when you add a value to any enum on the wire, give
that enum a `.catch()` in the same change if it has none. Otherwise the
addition is only additive for peers that already know it, which is the opposite
of what the contract promises.

The fallback is forward insurance and never retroactive: it lives in the build
doing the reading, so the peer that has not yet been updated is the one that
drops the message. Every enum reachable from `serverMessageSchema` or
`clientMessageSchema` is in scope, not only the progress ones.

It exists because the broader `calypso.adoc` is the architectural essay, while
this is the implementation contract future agents should follow.

## Goal

Progress must cross the daemon wire as facts, not as terminal escape-frame text.
A terminal progress bar is a renderer. It is not the protocol and not the source
of truth.

## Non-goals

- General live stdout/stderr streaming is a separate feature (#82).
- Exact terminal progress-bar parity is a follow-up (#83). Simple correct
  rendering is acceptable for #70, but parity is not abandoned.
- Workflow/job-tree progress producers are future work. Workflow progress should
  be derived from CUBE state snapshots, not daemon replay.

## Event shape

The internal engine event should be owned by the chell sink seam. The wire event
is the same shape plus the command correlation id:

```ts
type ProgressOperation = "upload" | "download" | "pull" | "workflow";
type ProgressKind = "transfer" | "retrieve" | "workflow";
type ProgressPhase =
  | "scanning"
  | "transferring"
  | "watching"
  | "retrying"
  | "complete"
  | "failed";
type ProgressUnit = "files" | "bytes" | "series" | "jobs" | "nodes";
type ProgressStatus =
  | "running"
  | "done"
  | "unconfirmed"
  | "stalled"
  | "timeout"
  | "error"
  | "unknown";

type ProgressEvent = {
  operation: ProgressOperation;
  kind?: ProgressKind;
  phase: ProgressPhase;
  label?: string;
  itemId?: string;
  current?: number;
  total?: number;
  percent?: number;
  unit?: ProgressUnit;
  status?: ProgressStatus;
};

type ProgressWireMessage = {
  type: "progress";
  id: string;
} & ProgressEvent;
```

Validation rules:

- `current` and `total`, when present, are non-negative.
- `percent`, when present, is between `0` and `100`.
- `total` and `percent` may be omitted when unknown.
- Do not require `current <= total`; PACS/LONK can exceed expected counts.
- `label` is display-only and may contain sensitive paths/study/file text. It is
  safe only for the originating surface that ran the command.
- `itemId` is optional for aggregate one-bar operations, but required by
  multi-item producers such as `pull` per series.

## Sink behavior

Extend the output sink with semantic progress:

```ts
interface OutputSink {
  data_write(chunk: string | Buffer): void;
  err_write(chunk: string | Buffer): void;
  status_write(text: string): void;
  progress_write(event: ProgressEvent): void;
}
```

Expected implementations:

- `StdoutSink`: render progress visibly for local CLI.
- `BufferSink`: no-op; progress is never captured.
- `CaptureSink`: forward to the live sink, like status.
- daemon sink: serialize as `progress` wire messages to the origin surface.
- remote engine/surface: route received progress to the active local sink or
  renderer.

Progress is live-only, origin-surface-only, and excluded from pipes, redirects,
capture buffers, and final envelopes.

Renderer failures must not abort the underlying command. Failed progress
forwarding should be debug-observable, not command-fatal.

## Producers

### `upload`

`chili` upload helpers should expose an optional local callback that reports
progress facts without importing chell or calypso types. `chell` adapts the
callback to `sink_get().progress_write(...)`.

For #70, aggregate progress is sufficient. Use one primary unit per event. Upload
currently knows file completion, not live network byte streaming.

### `download`

`chili` download helpers follow the same optional callback pattern.

For a single file with known size, byte progress can be primary. For directory
downloads, aggregate file progress is sufficient for #70.

### `pull`

`pull` constructs progress in `packages/chell/src/builtins/fs/pull.ts`, where
`SeriesPullTask` and LONK state are known.

Emit per-series events:

- `itemId`: series UID.
- `label`: current human-facing series label.
- `current`: actual file count reported/observed.
- `total`: expected or adjusted file count when known.
- `unit`: `files`.
- `status`: `running`, `done`, `unconfirmed`, `stalled`, `timeout`, or `error`.

`[NO LONK]` maps to `status: "unconfirmed"`.

## CUBE truth rule for `pull`

LONK is telemetry. CUBE materialization is truth.

- LONK done + CUBE verified: success.
- No LONK + CUBE verified: command success with `unconfirmed` progress.
- No LONK + CUBE not verified: error.
- Timeout/stall/error without CUBE verification: error.

Final `pull` result semantics should be anchored to CUBE materialization, not
LONK alone.

## TTY behavior

Progress facts are emitted regardless of `process.stdout.isTTY`. Only rendering
varies:

- TTY: bars or compact updating lines.
- non-TTY: newline summaries or suppressed noisy intermediate updates.
- browser/future UI: render structured state directly.

## Tests

Required automated coverage:

- CALYPSO protocol validation accepts valid `progress` messages and rejects
  malformed ones.
- sink tests prove progress is not captured and is forwarded live where
  appropriate.
- upload/download producer tests assert scanning/transferring/complete/failed
  progress events.
- pull producer tests assert running/done/stalled/timeout/error/unconfirmed/retry
  progress paths.
- remote transport test proves a remote engine receives and routes/renders
  progress.
- regression tests prove progress does not enter pipes, redirects, or final
  rendered output.

Required live materialization:

- add/update a live CUBE exemplar, gated by `CUBE_*` env/secrets and not required
  per PR.
- use scratch paths only and clean up after upload/download.
- the PACS E2E may pull and evaluate LONK-derived structured progress.
- missing LONK updates are valid only if represented as `unconfirmed` and CUBE
  materialization succeeds.
