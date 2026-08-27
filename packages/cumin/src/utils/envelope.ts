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

// The envelope's shape is contract, declared once in `@fnndsc/menu` and
// inferred from the schema that validates it on the wire. These names are
// re-exported here because cumin's helpers below produce and consume them, and
// because most of the stack has always reached them at this address.
// `StackMessage` is not re-exported: cumin's error stack owns that name and
// produces the values the wire shape describes.
export type {
  EnvelopeStatus,
  EnvelopeModel,
  ResolutionTrace,
  CommandEnvelope,
} from '@fnndsc/menu';

import type { EnvelopeModel, CommandEnvelope } from '@fnndsc/menu';




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
