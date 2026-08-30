/**
 * @file The wire-contract message schemas.
 *
 * Two discriminated unions, one per direction, keyed on a `type` tag:
 * {@link clientMessageSchema} (surface → daemon) and
 * {@link serverMessageSchema} (daemon → surface). Every request carries a
 * correlation `id` so its reply and any streamed output can be matched to
 * it, and output events carry the sink channel they belong to. These schemas
 * are the single source of truth for the protocol; the human-readable
 * description in `docs/calypso.adoc` is checked against them.
 *
 * @module
 */
import { z } from 'zod';
import { PROC_PROMPT_STATES } from './proc.js';
import {
  PROGRESS_KINDS,
  PROGRESS_OPERATIONS,
  PROGRESS_PHASES,
  PROGRESS_STATUSES,
  PROGRESS_UNITS,
} from './progress.js';
import { commandEnvelopeSchema } from './envelope.js';

/** The sink channel an output event belongs to. */
export const channelSchema = z.enum(['data', 'err', 'status']);

// --- Surface → daemon ------------------------------------------------------

/**
 * Capabilities an attaching surface can safely execute on its own machine.
 *
 * Optional throughout, and absent means false: a surface built against an older
 * contract simply declares less, and the daemon refuses what it did not claim
 * rather than assuming.
 */
export const surfaceCapabilitiesMessageSchema = z.object({
  shellCommands: z.boolean(),
  hiddenInput: z.boolean().optional(),
  /** Can put a file where its operator can reach it. */
  fileDelivery: z.boolean().optional(),
  /**
   * Has a filesystem of its own, so it can receive many files as a directory
   * structure. A browser cannot, and needs a directory archived into one file
   * before it can be handed over.
   */
  localFilesystem: z.boolean().optional(),
});

/** Attach to a session: declares the contract version, token, and surface capabilities. */
export const attachMessageSchema = z.object({
  type: z.literal('attach'),
  protocolVersion: z.number().int(),
  token: z.string(),
  session: z.string().optional(),
  capabilities: surfaceCapabilitiesMessageSchema.optional(),
});

/** Execute one input line, correlated by `id`. */
export const executeMessageSchema = z.object({
  type: z.literal('execute'),
  id: z.string(),
  line: z.string(),
});

/** Requests cancellation of the caller's currently executing command. */
export const cancelMessageSchema = z.object({
  type: z.literal('cancel'),
  id: z.string(),
});

/** Request completion candidates for a partial line, correlated by `id`. */
export const completeRequestSchema = z.object({
  type: z.literal('complete'),
  id: z.string(),
  prefix: z.string(),
});

/** Answers a prompt the daemon requested during a command, correlated by `promptId`. */
export const promptAnswerMessageSchema = z.object({
  type: z.literal('promptAnswer'),
  promptId: z.string(),
  answer: z.string(),
});

/** Reports a prompt failure to the daemon (surface cannot or did not answer), correlated by `promptId`. */
export const promptErrorMessageSchema = z.object({
  type: z.literal('promptError'),
  promptId: z.string(),
  reason: z.string(),
});

/** Returns the output of a pipeline segment the daemon asked the surface to run, correlated by `pipeId`. */
export const pipeResultMessageSchema = z.object({
  type: z.literal('pipeResult'),
  pipeId: z.string(),
  output: z.string(),
});

/** Returns a pipeline-segment failure to the daemon, correlated by `pipeId`. */
export const pipeErrorMessageSchema = z.object({
  type: z.literal('pipeError'),
  pipeId: z.string(),
  reason: z.string(),
});

/** Returns the exit code of a shell command the daemon asked the surface to run. */
export const shellResultMessageSchema = z.object({
  type: z.literal('shellResult'),
  shellId: z.string(),
  exitCode: z.number().int(),
});

/** Returns a surface shell-launch failure to the daemon, correlated by `shellId`. */
export const shellErrorMessageSchema = z.object({
  type: z.literal('shellError'),
  shellId: z.string(),
  reason: z.string(),
});

/** Returns the edited content from a local-edit the daemon requested, correlated by `editId`. */
export const editResultMessageSchema = z.object({
  type: z.literal('editResult'),
  editId: z.string(),
  content: z.string(),
  changed: z.boolean(),
});

/** Reports a local-edit failure to the daemon, correlated by `editId`. */
export const editErrorMessageSchema = z.object({
  type: z.literal('editError'),
  editId: z.string(),
  reason: z.string(),
});

/**
 * Reports a completed file delivery, correlated by `deliverId`.
 *
 * `location` is wherever the surface can honestly say the file went — an
 * absolute path for a filesystem, a bare filename for a browser that handed it
 * to the download manager.
 */
export const deliverResultMessageSchema = z.object({
  type: z.literal('deliverResult'),
  deliverId: z.string(),
  location: z.string(),
  bytes: z.number().nonnegative(),
});

/** Reports a failed file delivery to the daemon, correlated by `deliverId`. */
export const deliverErrorMessageSchema = z.object({
  type: z.literal('deliverError'),
  deliverId: z.string(),
  reason: z.string(),
});

/**
 * The operator's regard: the addressable thing most recently indicated on a
 * surface — a file clicked in a browser, a DAG node selected.
 *
 * The value is an address in the namespace (plus the model kind it was
 * indicated through), never view-space coordinates: what has no address is
 * view state and stays surface-side. `groupId` and `paneId` are provenance —
 * which link group and pane the indication happened in — so session-level
 * consumers know where regard came from without the surface's geometry ever
 * crossing the wire.
 */
export const regardSchema = z.object({
  address: z.string(),
  modelKind: z.string().optional(),
  groupId: z.string(),
  paneId: z.string(),
});

/** The session's retained regard value. */
export type Regard = z.infer<typeof regardSchema>;

/**
 * A regard write, travelling both directions under one shape: a surface
 * reports an indication to the daemon, and the daemon pushes the retained
 * session regard to every surface (last write wins; a late attacher receives
 * the retained value on attach).
 */
export const regardMessageSchema = z.object({
  type: z.literal('regard'),
  regard: regardSchema,
});

/** Any message a surface may send to the daemon. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  attachMessageSchema,
  executeMessageSchema,
  cancelMessageSchema,
  completeRequestSchema,
  promptAnswerMessageSchema,
  promptErrorMessageSchema,
  pipeResultMessageSchema,
  pipeErrorMessageSchema,
  shellResultMessageSchema,
  shellErrorMessageSchema,
  editResultMessageSchema,
  editErrorMessageSchema,
  deliverResultMessageSchema,
  deliverErrorMessageSchema,
  regardMessageSchema,
]);

/** A message a surface sends to the daemon. */
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Daemon → surface ------------------------------------------------------

/**
 * Acknowledges a successful attach. The optional `stack` block reports the
 * daemon's own installed versions and build hash, so a remote surface can
 * greet with the truth of the process it attached to rather than whatever is
 * installed client-side; older daemons simply omit it.
 */
export const attachedMessageSchema = z.object({
  type: z.literal('attached'),
  session: z.string(),
  protocolVersion: z.number().int(),
  stack: z
    .object({
      chell: z.string(),
      calypso: z.string(),
      build: z.string(),
      brasa: z.string().optional(),
      chili: z.string().optional(),
      salsa: z.string().optional(),
      cumin: z.string().optional(),
    })
    .optional(),
});

/** The final result of one executed line: one envelope per command. */
export const resultMessageSchema = z.object({
  type: z.literal('result'),
  id: z.string(),
  envelopes: z.array(commandEnvelopeSchema),
});

/** The reply to a completion request. */
export const completeReplySchema = z.object({
  type: z.literal('complete'),
  id: z.string(),
  prefix: z.string(),
  candidates: z.array(z.string()),
});

/** A streamed output event on one channel, correlated to its command. */
export const outputMessageSchema = z.object({
  type: z.literal('output'),
  id: z.string(),
  channel: channelSchema,
  chunk: z.string(),
});

/**
 * The operation producing structured progress.
 *
 * Within a major, the contract promises additive change only, which is a
 * promise a bare enum cannot keep: an unknown value fails the whole message,
 * and a failed parse drops it. An operation a peer names but this build does
 * not know is therefore read as `task` — none of the above — so the work still
 * shows, generically, instead of vanishing.
 */
export const progressOperationSchema = z.enum(PROGRESS_OPERATIONS).catch('task');

/**
 * Broad class of progress producer.
 *
 * Optional, so an unknown class degrades to absent: the event still renders
 * from its operation and phase, one axis poorer.
 */
export const progressKindSchema = z.enum(PROGRESS_KINDS).catch(undefined as never);

/**
 * Lifecycle phase of a progress operation.
 *
 * An unknown phase degrades to `working` for the reason given on
 * {@link progressOperationSchema}: an unrecognised phase still means work is
 * under way, and that much is worth showing. `complete` and `failed` are
 * terminal and will not be inferred, so a surface that cannot read a newer
 * peer's terminal phase leaves the announcement open rather than closing it
 * wrongly.
 */
export const progressPhaseSchema = z.enum(PROGRESS_PHASES).catch('working');

/**
 * Unit used by the primary progress counter.
 *
 * Optional, so an unknown unit degrades to absent and the counter renders
 * unqualified — 3/10 rather than nothing at all.
 */
export const progressUnitSchema = z.enum(PROGRESS_UNITS).catch(undefined as never);

/**
 * State of the operation or item being reported.
 *
 * An unknown state degrades to `unknown`, which the vocabulary already carries
 * for precisely this: a state that cannot be named is still a state.
 */
export const progressStatusSchema = z.enum(PROGRESS_STATUSES).catch('unknown');

/** A structured progress event correlated to a command. */
export const progressMessageSchema = z.object({
  type: z.literal('progress'),
  id: z.string(),
  operation: progressOperationSchema,
  kind: progressKindSchema.optional(),
  phase: progressPhaseSchema,
  label: z.string().optional(),
  itemId: z.string().optional(),
  current: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  percent: z.number().min(0).max(100).optional(),
  unit: progressUnitSchema.optional(),
  status: progressStatusSchema.optional(),
});

/** A progress event as it appears on the wire, correlated to its command. */
export type ProgressMessage = z.infer<typeof progressMessageSchema>;

/** The progress payload before command correlation is added by the daemon. */
export type ProgressEvent = Omit<ProgressMessage, 'type' | 'id'>;

/** A session-bus broadcast: an envelope tagged with its originating surface. */
export const sessionMessageSchema = z.object({
  type: z.literal('session'),
  surface: z.string(),
  envelope: commandEnvelopeSchema,
});

/** A boundary error: a refused attach, a malformed message, correlated when possible. */
export const errorMessageSchema = z.object({
  type: z.literal('error'),
  id: z.string().optional(),
  reason: z.string(),
});

/**
 * A prompt request the daemon raises during a command: the surface that
 * submitted the command must answer it (with `promptAnswer`) before the
 * command can proceed. `hidden` requests no-echo entry (password).
 */
export const promptMessageSchema = z.object({
  type: z.literal('prompt'),
  promptId: z.string(),
  message: z.string(),
  hidden: z.boolean(),
});

/**
 * The engine-known facts a prompt reflects, independent of any theme.
 *
 * The daemon knows the session context but not how a given surface renders it,
 * so it ships these facts and each surface themes them with its own settings.
 * Rendering inputs a surface owns (theme, segments, terminal width) are not
 * carried here.
 */
export const promptContextSchema = z.object({
  user: z.string(),
  uri: z.string(),
  cwd: z.string(),
  pacsserver: z.string().nullable(),
  physicalMode: z.boolean(),
  lastExitCode: z.number(),
  lastCommandDurationMs: z.number(),
  procWarmup: z.object({
    loaded: z.number(),
    total: z.number().optional(),
    restored: z.boolean().optional(),
    state: z.enum(PROC_PROMPT_STATES).optional(),
  }).optional(),
  procIndex: z.object({
    jobs: z.number(),
    feeds: z.number(),
  }).optional(),
});

export type PromptContext = z.infer<typeof promptContextSchema>;

/**
 * The prompt context, pushed by the daemon with each result and on any context
 * change. The daemon knows the session context; each surface renders it with
 * its own theme, so prompt themes are a per-surface choice rather than the
 * daemon's.
 */
export const promptLineMessageSchema = z.object({
  type: z.literal('promptline'),
  context: promptContextSchema,
});

/**
 * Asks the surface to run a pipeline segment on its own machine (never on the
 * daemon host) and return the output. `input` and the reply's `output` are
 * base64, since segment data is arbitrary bytes.
 */
export const pipeMessageSchema = z.object({
  type: z.literal('pipe'),
  pipeId: z.string(),
  command: z.string(),
  input: z.string(),
});

/** Asks the surface to run a shell command on its own machine, never on the daemon host. */
export const shellMessageSchema = z.object({
  type: z.literal('shell'),
  shellId: z.string(),
  command: z.string(),
});

/**
 * Asks the surface to open content in its local editor (never on the daemon
 * host) and return the edited result.
 */
export const editMessageSchema = z.object({
  type: z.literal('edit'),
  editId: z.string(),
  content: z.string(),
  extension: z.string().optional(),
});

/**
 * Asks the surface running the current command to place a file where its
 * operator can reach it.
 *
 * The message names what to deliver, never the bytes. A surface fetches those
 * itself from the daemon's token-gated byte route, so a large file does not
 * cross the session bus base64-encoded — the intent travels through the
 * vocabulary and the bytes travel through the byte route.
 */
export const deliverMessageSchema = z.object({
  type: z.literal('deliver'),
  deliverId: z.string(),
  path: z.string(),
  filename: z.string(),
  destination: z.string().optional(),
  size: z.number().nonnegative().optional(),
  contentType: z.string().optional(),
});

/** What to deliver, before the daemon adds the correlation id. */
export type FileDeliverRequest = Omit<z.infer<typeof deliverMessageSchema>, 'type' | 'deliverId'>;

/** Where a delivered file landed, as the surface reports it. */
export type FileDeliverResult = Omit<
  z.infer<typeof deliverResultMessageSchema>,
  'type' | 'deliverId'
>;

/**
 * The daemon's heartbeat, pushed roughly once a second while any surface is
 * attached: the live process-index counts. Event-driven facts (progress,
 * command latency) travel on their own messages; this carries only what
 * changes without a command.
 */
export const telemetryMessageSchema = z.object({
  type: z.literal('telemetry'),
  index: z.object({
    jobs: z.number(),
    feeds: z.number(),
  }),
});

/** Any message the daemon may send to a surface. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  attachedMessageSchema,
  resultMessageSchema,
  completeReplySchema,
  outputMessageSchema,
  progressMessageSchema,
  sessionMessageSchema,
  errorMessageSchema,
  promptMessageSchema,
  promptLineMessageSchema,
  telemetryMessageSchema,
  pipeMessageSchema,
  shellMessageSchema,
  editMessageSchema,
  deliverMessageSchema,
  regardMessageSchema,
]);

/** A message the daemon sends to a surface. */
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * The message types this contract build knows. A surface receiving a typed
 * message outside this set is talking to a newer daemon: the open-world rule
 * is to skip it quietly, not to warn on every arrival.
 */
export const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  serverMessageSchema.options.map((option): string => option.shape.type.value),
);
