/**
 * @file The error stack, re-exported from `@fnndsc/fond`.
 *
 * The process-wide, async-context-aware stack belongs to fond. cumin
 * re-exports it, never copies it: a second copy would be a second singleton,
 * and errors pushed through one would be invisible to a drain of the other.
 *
 * @module
 */
export { errorStack, errorStack_configure, errorStack_getAllOfType } from '@fnndsc/fond';
export type { StackMessage } from '@fnndsc/fond';
