/**
 * @file Command result envelope.
 *
 * Defines the envelope in which a command's outcome travels from execution
 * to whatever hosts it: a REPL printing to a terminal, a daemon serving
 * remote surfaces, or a pipeline consuming the output of a prior command.
 * The envelope carries both renderings of a result: the text a terminal
 * prints (ANSI permitted) and an optional typed model from which a
 * graphical panel can render the same result structurally.
 *
 * The model slot is discriminated but deliberately untyped here: cumin
 * knows the shape of the slot, never the payloads. Layers that own domain
 * models (chili) export the kind-to-type mapping; layers that publish a
 * wire contract (calypso) validate the slot at their boundary.
 *
 * Error detail is carried in the envelope rather than left implicit in the
 * process-wide errorStack: the dispatch boundary checkpoints the stack
 * before a command runs and drains anything pushed above the checkpoint
 * into the envelope afterward.
 *
 * @see docs/calypso.adoc for the governing design.
 * @module
 */

import { StackMessage } from "../error/errorStack";

/**
 * Terminal status of a completed command.
 *
 * Additional statuses may be added over time; consumers must treat the
 * union as open and handle unknown values conservatively.
 */
export type EnvelopeStatus = "ok" | "error";

/**
 * Discriminated slot for a command's typed result.
 *
 * @property kind - Namespaced model identifier (e.g. `fs.listing`,
 *   `feed.detail`). The set of kinds is owned by the layer that produces
 *   the models, not by cumin.
 * @property data - The typed payload. Opaque at this altitude; consumers
 *   narrow it via the kind map exported by the producing layer.
 */
export interface EnvelopeModel {
  kind: string;
  data: unknown;
}

/**
 * Record of how a natural-language input was resolved into a command.
 *
 * Present only on envelopes produced through intent resolution, so that
 * surfaces can show what was proposed and what actually ran rather than
 * hiding the mediation.
 *
 * @property input - The user's original input, verbatim.
 * @property proposed - The command line proposed by the resolver.
 * @property validated - Whether the proposal passed validation against the
 *   live command vocabulary.
 * @property executed - The command line that actually ran, when execution
 *   proceeded. Absent when validation failed or confirmation was declined.
 */
export interface ResolutionTrace {
  input: string;
  proposed: string;
  validated: boolean;
  executed?: string;
}

/**
 * The envelope in which one command's complete outcome travels.
 *
 * Exactly one envelope concludes each executed command. Streaming output
 * that preceded completion is a transport concern; the envelope's rendered
 * field holds the accumulated data-channel text, so capture, piping, and
 * redirection consume the envelope alone.
 *
 * @property status - Terminal status of the command.
 * @property rendered - Accumulated printable output (ANSI permitted).
 * @property renderedErr - Printable error-stream output (ANSI permitted),
 *   exactly what a terminal host writes to stderr. Kept separate from
 *   `rendered` so pipes and capture consume only the data stream.
 * @property model - Optional typed result for structural consumers.
 * @property errors - Structured error detail drained from the errorStack at
 *   the dispatch boundary, for machine consumers; presentation of errors on
 *   a terminal travels in `renderedErr`.
 * @property trace - Resolution record for intent-derived commands.
 */
export interface CommandEnvelope {
  status: EnvelopeStatus;
  rendered: string;
  renderedErr?: string;
  model?: EnvelopeModel;
  errors?: StackMessage[];
  trace?: ResolutionTrace;
}

/**
 * Creates a successful envelope.
 *
 * @param rendered - Accumulated printable output of the command.
 * @param model - Optional typed result.
 * @returns An envelope with `ok` status.
 */
export function envelope_ok(rendered: string, model?: EnvelopeModel): CommandEnvelope {
  const envelope: CommandEnvelope = { status: "ok", rendered };
  if (model !== undefined) {
    envelope.model = model;
  }
  return envelope;
}

/**
 * Creates a failed envelope.
 *
 * @param rendered - Any printable output produced before failure.
 * @param errors - Structured error detail drained from the errorStack.
 * @param renderedErr - Printable error-stream output (ANSI permitted).
 * @returns An envelope with `error` status.
 */
export function envelope_error(
  rendered: string,
  errors?: StackMessage[],
  renderedErr?: string,
): CommandEnvelope {
  const envelope: CommandEnvelope = { status: "error", rendered };
  if (errors !== undefined) {
    envelope.errors = errors;
  }
  if (renderedErr !== undefined) {
    envelope.renderedErr = renderedErr;
  }
  return envelope;
}

/**
 * Type guard for successful envelopes.
 *
 * @param envelope - The envelope to check.
 * @returns True when the envelope's status is `ok`.
 */
export function envelope_isOk(envelope: CommandEnvelope): boolean {
  return envelope.status === "ok";
}
