/**
 * @file Boundary validation.
 *
 * Every message is validated on the way in and out. Structural violations
 * (missing required fields, wrong types, an unknown `type`) are rejected;
 * unknown *additional* fields are tolerated (stripped), so a daemon accepts
 * additive extensions from a newer minor without understanding them. Parsing
 * never throws — it returns a {@link ParseResult} so the caller can answer a
 * malformed message with an `error` message rather than dropping the socket.
 *
 * @module
 */
import { z } from 'zod';
import {
  clientMessageSchema,
  serverMessageSchema,
  attachMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from './messages.js';
import { version_isCompatible } from './version.js';

/**
 * The outcome of validating a message at the boundary.
 *
 * @property ok - Whether the input was a valid message.
 * @property value - The parsed message, when `ok`.
 * @property error - A human-readable reason, when not `ok`.
 */
export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * Formats a Zod error into a compact, single-line boundary reason.
 *
 * @param error - The Zod validation error.
 * @returns A human-readable reason string.
 */
function zodError_format(error: z.ZodError): string {
  return error.issues
    .map((issue: z.ZodIssue): string => {
      const path: string = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Validates a raw value against a schema, never throwing.
 *
 * @param schema - The schema to validate against.
 * @param raw - The untrusted input.
 * @returns The parse result.
 */
function schema_parse<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const result: z.SafeParseReturnType<unknown, T> = schema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: zodError_format(result.error) };
}

/**
 * Validates a message a surface sent to the daemon.
 *
 * @param raw - The untrusted input (already JSON-parsed).
 * @returns The parse result.
 */
export function clientMessage_parse(raw: unknown): ParseResult<ClientMessage> {
  return schema_parse(clientMessageSchema, raw);
}

/**
 * Validates a message the daemon sent to a surface.
 *
 * @param raw - The untrusted input (already JSON-parsed).
 * @returns The parse result.
 */
export function serverMessage_parse(raw: unknown): ParseResult<ServerMessage> {
  return schema_parse(serverMessageSchema, raw);
}

/**
 * Parses a JSON string into a client message, rejecting both malformed JSON
 * and structurally invalid messages with a clear reason.
 *
 * @param json - The raw JSON text received on the socket.
 * @returns The parse result.
 */
export function clientMessage_fromJson(json: string): ParseResult<ClientMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `malformed JSON: ${message}` };
  }
  return clientMessage_parse(parsed);
}

/**
 * Validates an attach message and checks its declared contract version
 * against this build. A structurally valid attach on an incompatible major
 * is rejected with a clear reason.
 *
 * @param raw - The untrusted input (already JSON-parsed).
 * @returns The parse result; an incompatible version is a validation failure.
 */
export function attach_parse(raw: unknown): ParseResult<z.infer<typeof attachMessageSchema>> {
  const parsed: ParseResult<z.infer<typeof attachMessageSchema>> = schema_parse(attachMessageSchema, raw);
  if (!parsed.ok || parsed.value === undefined) {
    return parsed;
  }
  if (!version_isCompatible(parsed.value.protocolVersion)) {
    return {
      ok: false,
      error: `incompatible contract version ${parsed.value.protocolVersion}`,
    };
  }
  return parsed;
}
