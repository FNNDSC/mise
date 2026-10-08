/**
 * @file Result, re-exported from `@fnndsc/fond`.
 *
 * Result belongs to fond, which holds the pieces every layer needs whatever
 * the backend. cumin re-exports it so imports from cumin and from fond are
 * the one implementation.
 *
 * @module
 */
export { Ok, Err, result_isOk, result_isErr } from '@fnndsc/fond';
export type { Result } from '@fnndsc/fond';
