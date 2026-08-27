/**
 * @file The wire schema for a command envelope.
 *
 * cumin defines the `CommandEnvelope` type (the shape produced in-stack);
 * calypso owns the wire schema that validates that envelope at the boundary
 * — the published promise an external surface programs against. The two are
 * kept in step by a compile-time check below: if cumin's type gains a field
 * the wire schema does not cover, this file stops compiling, so the contract
 * can never silently drift from what the code produces.
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

/** The record of how a natural-language input resolved into a command. */
export type ResolutionTrace = z.infer<typeof resolutionTraceSchema>;
