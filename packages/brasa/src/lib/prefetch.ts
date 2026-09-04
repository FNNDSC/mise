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
import { announceIndent_get } from './announceIndent.js';

/**
 * Status-tag column assumed when a host does not declare its own.
 *
 * Hosts that render a status tag before the label pass their real width,
 * so the spinner and the finished row agree on where the label starts.
 */
const DEFAULT_STATUS_WIDTH: number = 7;

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
 * @param statusWidth  - Width of the host's status-tag column, so a running
 *   row's label lines up with the finished row that replaces it.
 */
export async function prefetch_withSpinner(
  label: string,
  message: string,
  isInteractive: boolean,
  action: () => Promise<PrefetchResult>,
  statusWidth: number = DEFAULT_STATUS_WIDTH,
): Promise<PrefetchResult> {
  const paddedLabel: string = label.padEnd(12);
  const showSpinner: boolean = isInteractive && process.stdout.isTTY;
  // A running row and the finished row that replaces it describe the same
  // step, so their labels must start in the same column. The host writes
  // its status tag then a space, which is the column to match. An animated
  // spinner already writes a glyph and a space of its own and owes only the
  // remainder; a plain log line writes nothing and owes the whole width.
  const indent: number = announceIndent_get(statusWidth, showSpinner);
  const spinnerMessage: string = `${' '.repeat(indent)}${paddedLabel} ${message}`;

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
