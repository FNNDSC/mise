/**
 * @file A command envelope: its wire schema, its type, and the helpers that
 * make one.
 *
 * The envelope carries a command's whole outcome from the engine to whatever
 * hosts it: the text a terminal prints, an optional typed model a graphical
 * surface renders from, and the errors the command raised. The type is
 * inferred from the schema that validates it on the wire, so the shape the
 * engine produces and the shape a surface accepts are one declaration.
 *
 * @module
 */
import { z } from 'zod';

/** Terminal status of a completed command. */
export const envelopeStatusSchema = z.enum(['ok', 'error']);

/** A single structured error/warning drained from the error stack. */
export const stackMessageSchema = z.object({
  type: z.enum(['error', 'warning']),
  message: z.string(),
});

/** A command's typed result: a namespaced kind and an opaque payload. */
export const envelopeModelSchema = z.object({
  kind: z.string(),
  data: z.unknown(),
});

/** The record of how a natural-language input resolved into a command. */
export const resolutionTraceSchema = z.object({
  input: z.string(),
  proposed: z.string(),
  validated: z.boolean(),
  executed: z.string().optional(),
});

/**
 * The envelope in which one command's complete outcome crosses the wire.
 */
export const commandEnvelopeSchema = z.object({
  status: envelopeStatusSchema,
  rendered: z.string(),
  renderedErr: z.string().optional(),
  model: envelopeModelSchema.optional(),
  errors: z.array(stackMessageSchema).optional(),
  trace: resolutionTraceSchema.optional(),
});

/**
 * The envelope in which one command's outcome crosses the wire.
 *
 * Inferred from the schema rather than declared beside it. The engine and the
 * wire once carried separate declarations of this shape, tied together by a
 * compile-time assertion that one remained assignable to the other; a single
 * inferred type makes that drift impossible instead of detected.
 */
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

/** Prior name for {@link CommandEnvelope}, kept for existing importers. */
export type WireEnvelope = CommandEnvelope;

/** Terminal status of a completed command. */
export type EnvelopeStatus = z.infer<typeof envelopeStatusSchema>;

/** A command's typed result: a namespaced kind and an opaque payload. */
export type EnvelopeModel = z.infer<typeof envelopeModelSchema>;

/** A structured error or warning drained from the error stack. */
export type StackMessage = z.infer<typeof stackMessageSchema>;

/**
 * Creates a successful envelope.
 *
 * @param rendered - Accumulated printable output of the command.
 * @param model - Optional typed result.
 * @returns An envelope with `ok` status.
 */
export function envelope_ok(rendered: string, model?: EnvelopeModel): CommandEnvelope {
  const envelope: CommandEnvelope = { status: 'ok', rendered };
  if (model !== undefined) {
    envelope.model = model;
  }
  return envelope;
}

/**
 * Creates a failed envelope.
 *
 * @param rendered - Any printable output produced before failure.
 * @param errors - Structured error detail drained from the error stack.
 * @param renderedErr - Printable error-stream output (ANSI permitted).
 * @returns An envelope with `error` status.
 */
export function envelope_error(
  rendered: string,
  errors?: StackMessage[],
  renderedErr?: string,
): CommandEnvelope {
  const envelope: CommandEnvelope = { status: 'error', rendered };
  if (errors !== undefined) {
    envelope.errors = errors;
  }
  if (renderedErr !== undefined) {
    envelope.renderedErr = renderedErr;
  }
  return envelope;
}

/**
 * Whether an envelope succeeded.
 *
 * @param envelope - The envelope to check.
 * @returns True when its status is `ok`.
 */
export function envelope_isOk(envelope: CommandEnvelope): boolean {
  return envelope.status === 'ok';
}

/** The record of how a natural-language input resolved into a command. */
export type ResolutionTrace = z.infer<typeof resolutionTraceSchema>;
