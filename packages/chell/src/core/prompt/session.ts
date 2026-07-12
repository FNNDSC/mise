/**
 * @file Rendering the current session's themed prompt string.
 *
 * The prompt reflects live session context — user, CUBE, working directory,
 * PACS, physical-mode, warm-up progress — which only the process holding that
 * context can render. Both the local REPL and the daemon (which pushes the
 * prompt to remote surfaces) render it here, so the same theme produces the
 * same string on every surface.
 *
 * @module
 */
import { sessionPromptContext_build, type SessionPromptContext } from '@fnndsc/brasa';
import { settings } from '../../config/settings.js';
import { prompt_render, type PromptContext } from './index.js';

/**
 * Inputs the caller knows that the session state does not.
 *
 * @property lastExitCode - The previous command's exit code (default 0).
 * @property lastCommandDurationMs - The previous command's duration (default 0).
 * @property terminalWidth - The rendering width (default the local stdout
 *   columns, or 80).
 */
export interface SessionPromptOptions {
  lastExitCode?: number;
  lastCommandDurationMs?: number;
  terminalWidth?: number;
}

/**
 * Renders a themed prompt string from an engine prompt context.
 *
 * Combines the engine-known facts with this surface's own rendering inputs
 * (theme, enabled segments, terminal width) and renders. Used both for the
 * local session and for a context pushed by a remote daemon, so every surface
 * themes the prompt its own way from the same facts.
 *
 * @param context - The engine-known prompt facts.
 * @param terminalWidth - The rendering width (default local stdout columns, or 80).
 * @returns The rendered prompt string.
 */
export function promptFromContext_render(context: SessionPromptContext, terminalWidth?: number): string {
  const ctx: PromptContext = {
    ...context,
    terminalWidth: terminalWidth ?? (process.stdout.columns || 80),
    p10kSegments:  settings.config.p10kSegments,
  };
  return prompt_render(settings.config.promptTheme, ctx);
}

/**
 * Renders the themed prompt string for the current local session context.
 *
 * @param options - The last-command and width inputs.
 * @returns The rendered prompt string.
 */
export async function sessionPrompt_render(options: SessionPromptOptions = {}): Promise<string> {
  const context: SessionPromptContext = await sessionPromptContext_build({
    lastExitCode:          options.lastExitCode,
    lastCommandDurationMs: options.lastCommandDurationMs,
  });
  return promptFromContext_render(context, options.terminalWidth);
}
