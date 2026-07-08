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
import { commandEnvelopeSchema } from './envelope.js';

/** The sink channel an output event belongs to. */
export const channelSchema = z.enum(['data', 'err', 'status']);

// --- Surface → daemon ------------------------------------------------------

/** Attach to a session: declares the contract version and the attach token. */
export const attachMessageSchema = z.object({
  type: z.literal('attach'),
  protocolVersion: z.number().int(),
  token: z.string(),
  session: z.string().optional(),
});

/** Execute one input line, correlated by `id`. */
export const executeMessageSchema = z.object({
  type: z.literal('execute'),
  id: z.string(),
  line: z.string(),
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

/** Any message a surface may send to the daemon. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  attachMessageSchema,
  executeMessageSchema,
  completeRequestSchema,
  promptAnswerMessageSchema,
]);

/** A message a surface sends to the daemon. */
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Daemon → surface ------------------------------------------------------

/** Acknowledges a successful attach. */
export const attachedMessageSchema = z.object({
  type: z.literal('attached'),
  session: z.string(),
  protocolVersion: z.number().int(),
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

/** Any message the daemon may send to a surface. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  attachedMessageSchema,
  resultMessageSchema,
  completeReplySchema,
  outputMessageSchema,
  sessionMessageSchema,
  errorMessageSchema,
  promptMessageSchema,
]);

/** A message the daemon sends to a surface. */
export type ServerMessage = z.infer<typeof serverMessageSchema>;
