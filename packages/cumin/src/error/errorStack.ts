/**
 * @file The error stack, now fond's (backend-neutral step 1, #987).
 *
 * The process-wide, async-context-aware stack moved to `@fnndsc/fond`. It is
 * re-exported, never copied: a second copy would be a second singleton, and
 * errors pushed through one would be invisible to a drain of the other.
 *
 * @module
 */
export { errorStack, errorStack_configure, errorStack_getAllOfType } from '@fnndsc/fond';
export type { StackMessage } from '@fnndsc/fond';
