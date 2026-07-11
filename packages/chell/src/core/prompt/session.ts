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
import { session } from '@fnndsc/brasa';
import { settings } from '../../config/settings.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext, procCache_get, type ProcWarmupProgress } from '@fnndsc/cumin';
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
 * Renders the themed prompt string for the current session context.
 *
 * @param options - The last-command and width inputs.
 * @returns The rendered prompt string.
 */
export async function sessionPrompt_render(options: SessionPromptOptions = {}): Promise<string> {
  const context: SingleContext = await context_getSingle();
  const cwd: string = await session.getCWD();
  const isOffline: boolean = session.offline;

  const warmupRaw: ProcWarmupProgress = procCache_get().warmupProgress_get();
  const procWarmup: { loaded: number } | undefined =
    warmupRaw.active ? { loaded: warmupRaw.loaded } : undefined;

  const ctx: PromptContext = {
    user:                  isOffline ? 'disconnected' : (context.user ?? 'disconnected'),
    uri:                   isOffline ? 'no-cube'      : (context.URL  ?? 'no-cube'),
    cwd:                   isOffline ? '/'            : cwd,
    pacsserver:            context.pacsserver ?? null,
    physicalMode:          session.physicalMode_get(),
    terminalWidth:         options.terminalWidth ?? (process.stdout.columns || 80),
    lastExitCode:          options.lastExitCode ?? 0,
    lastCommandDurationMs: options.lastCommandDurationMs ?? 0,
    p10kSegments:          settings.config.p10kSegments,
    procWarmup,
  };

  return prompt_render(settings.config.promptTheme, ctx);
}
