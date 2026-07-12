/**
 * @file Boot-time prefetch helpers for warming the VFS cache.
 *
 * Extracted from chell_start() to keep that fn focused on orchestration.
 * All functions are pure top-level — no closure over session state.
 *
 * @module
 */
import { errorStack } from '@fnndsc/cumin';
import { vfs } from './vfs/vfs.js';
import { spinner } from './spinner.js';
import { error_stripDebugPrefix } from '../builtins/index.js';

/**
 * Outcome of a prefetch operation (counts and status).
 */
export interface PrefetchResult {
  ok: boolean;
  count?: number;
  pipelineCount?: number;
  message?: string;
}

/**
 * Prefetch a VFS path into the list cache.
 *
 * @param target - Absolute VFS path to prefetch.
 * @returns Count of items cached on success, error message on failure.
 */
export async function prefetch_path(target: string): Promise<PrefetchResult> {
  try {
    const result = await vfs.data_get(target);
    if (result.ok) {
      return { ok: true, count: result.value.length };
    }
    const err = errorStack.stack_pop();
    return { ok: false, message: err ? error_stripDebugPrefix(err.message) : `Prefetch failed for ${target}` };
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

/**
 * Run a prefetch action behind a spinner (interactive) or plain log (non-interactive).
 *
 * @param label        - Short label shown in the spinner column (padded to 12 chars).
 * @param message      - Descriptive message shown next to the label.
 * @param isInteractive - Whether the session is interactive (controls spinner vs plain log).
 * @param action       - Async work to run; returns a PrefetchResult.
 */
export async function prefetch_withSpinner(
  label: string,
  message: string,
  isInteractive: boolean,
  action: () => Promise<PrefetchResult>,
): Promise<PrefetchResult> {
  const paddedLabel: string = label.padEnd(12);
  // Spinner adds its own glyph and a following space. Pad so the label column
  // aligns with the fixed-width status logs (e.g., "[ OK ] " = 7 chars).
  const spinnerPrefix: string = ' '.repeat(5); // 1 glyph + 1 space + 5 = 7
  const spinnerMessage: string = `${spinnerPrefix}${paddedLabel} ${message}`;
  const showSpinner: boolean = isInteractive && process.stdout.isTTY;

  if (showSpinner) {
    spinner.start(spinnerMessage, true);
  } else {
    console.log(spinnerMessage);
  }

  try {
    return await action();
  } finally {
    if (showSpinner) {
      spinner.stop();
      process.stdout.write('\r\x1b[K');
    }
  }
}
