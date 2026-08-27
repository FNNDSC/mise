/**
 * @file The progress renderer seam.
 *
 * The engine emits progress and knows nothing about how it is shown; a host
 * supplies the renderer. The vocabulary the events are built from is contract,
 * and lives in `@fnndsc/menu`; it is re-exported here so existing importers
 * reach it at its familiar name.
 *
 * @module
 */

export {
  PROGRESS_OPERATIONS,
  PROGRESS_KINDS,
  PROGRESS_PHASES,
  PROGRESS_UNITS,
  PROGRESS_STATUSES,
  type ProgressOperation,
  type ProgressKind,
  type ProgressPhase,
  type ProgressUnit,
  type ProgressStatus,
  type ProgressEvent,
} from '@fnndsc/menu';

import type { ProgressEvent } from '@fnndsc/menu';

/**
 * Renders progress events for a frontend.
 *
 * The engine emits {@link ProgressEvent}s and knows nothing about how they are
 * shown. Each frontend supplies its own implementation: a terminal draws bars,
 * a daemon forwards the events over its wire, a headless host drops them.
 */
export interface ProgressRenderer {
  /**
   * Renders a single progress event.
   *
   * @param event - The progress telemetry to render.
   */
  write(event: ProgressEvent): void;
}

/**
 * Progress renderer that drops every event.
 *
 * The engine's default when no frontend has supplied a live renderer, so
 * headless hosts incur no terminal coupling.
 */
export class NullProgressRenderer implements ProgressRenderer {
  /** @inheritdoc */
  public write(_event: ProgressEvent): void {
    // Progress is live telemetry: with no frontend to render it, it is dropped.
  }
}
