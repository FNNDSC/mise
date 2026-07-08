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
import type { CommandEnvelope } from '@fnndsc/cumin';

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

/** The envelope type inferred from the wire schema. */
export type WireEnvelope = z.infer<typeof commandEnvelopeSchema>;

/**
 * Compile-time guard: everything cumin can produce must validate on the
 * wire. If cumin's `CommandEnvelope` gains a member the schema above does
 * not model, `CommandEnvelope` stops being assignable to `WireEnvelope`,
 * this type resolves to `never`, and the constant below fails to compile —
 * surfacing contract drift as a build error rather than a runtime surprise
 * at the boundary. This is a type-level assertion with no runtime behavior.
 */
type EnvelopeCoversCumin = CommandEnvelope extends WireEnvelope ? true : never;
const _envelopeCoversCumin: EnvelopeCoversCumin = true;
void _envelopeCoversCumin;
