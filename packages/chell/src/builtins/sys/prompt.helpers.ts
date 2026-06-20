/**
 * @file Pure helpers for the `prompt` builtin.
 *
 * Builds the prompt rendering context (applying offline fallbacks) and parses
 * the interactive segment-toggle input. Dependency-free for easy unit testing.
 *
 * @module
 */
import type { PromptContext, P10kSegmentConfig } from '../../core/prompt/index.js';
import type { SingleContext } from '@fnndsc/cumin';

/**
 * Builds a {@link PromptContext} from session/context state, applying the
 * "disconnected"/"no-cube"/"/" fallbacks used when offline.
 *
 * @param context - The current single context.
 * @param cwd - The current working directory.
 * @param isOffline - Whether the session is offline.
 * @param physicalMode - Whether physical (vs logical) path mode is active.
 * @param terminalWidth - The terminal width in columns.
 * @param p10kSegments - The configured p10k segment toggles.
 * @returns The assembled prompt context.
 */
export function promptContext_build(
  context: SingleContext,
  cwd: string,
  isOffline: boolean,
  physicalMode: boolean,
  terminalWidth: number,
  p10kSegments: P10kSegmentConfig
): PromptContext {
  return {
    user: isOffline ? 'disconnected' : (context.user ?? 'disconnected'),
    uri: isOffline ? 'no-cube' : (context.URL ?? 'no-cube'),
    cwd: isOffline ? '/' : cwd,
    pacsserver: context.pacsserver ?? null,
    physicalMode,
    terminalWidth,
    lastExitCode: 0,
    lastCommandDurationMs: 0,
    p10kSegments,
  };
}

/**
 * Splits interactive segment-toggle input into individual segment tokens,
 * accepting whitespace- or comma-separated names.
 *
 * @param answer - The raw user input.
 * @returns The non-empty tokens.
 */
export function segmentTokens_parse(answer: string): string[] {
  return answer.split(/[\s,]+/).filter((t: string) => t.length > 0);
}
