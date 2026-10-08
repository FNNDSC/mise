/**
 * @file Result, now fond's (backend-neutral step 1, #987).
 *
 * The Result type moved to `@fnndsc/fond`, the neutral base under the
 * engine, so a layer that is not about CUBE can use it without loading
 * CUBE's client. Re-exported here so every existing import keeps working.
 *
 * @module
 */
export { Ok, Err, result_isOk, result_isErr } from '@fnndsc/fond';
export type { Result } from '@fnndsc/fond';
