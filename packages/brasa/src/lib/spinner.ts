/**
 * @file Indeterminate-progress announcer for long-running work.
 *
 * A command that cannot say how much work remains still owes the operator the
 * fact that work is under way. This announces that fact as a structured
 * progress event; it does not draw it. Frame choreography — the braille cycle,
 * the erase-line, the elapsed counter — belongs to whichever renderer is
 * attached, because a browser, a terminal and a log each express waiting
 * differently and none of them should have to recover meaning from cursor
 * movement.
 *
 * The class keeps its former name and call signature so its many callers need
 * no change, but it is no longer a terminal utility: it emits `operation:
 * 'task'` with `kind: 'inspection'`, and the surface decides the rest.
 *
 * @module
 */

import { sink_get } from '../core/sink.js';

/**
 * Announces indeterminate progress for async work.
 *
 * `start` opens an announcement, `updateMessage` revises its label, and `stop`
 * closes it. Only state changes cross the wire: a spin that lasts a minute
 * costs two events, not one per animation frame.
 */
export class Spinner {
  private message: string = '';
  private spinnerActive: boolean = false;

  /**
   * @param initialMessage - Label used when `start` is called without one.
   */
  constructor(initialMessage: string = 'Loading...') {
    this.message = initialMessage;
  }

  /**
   * Opens an indeterminate-progress announcement.
   *
   * @param message - Label describing the work; defaults to the last label set.
   * @param _showTiming - Retained for call-site compatibility. Elapsed time is
   *   now the renderer's to measure and display, since only the renderer knows
   *   whether it can show a live counter at all.
   */
  public start(message?: string, _showTiming: boolean = false): void {
    if (this.spinnerActive) {
      this.stop();
    }
    this.message = message ?? this.message;
    this.spinnerActive = true;
    this.progress_emit('working');
  }

  /**
   * Closes the announcement.
   *
   * @param _clearLine - Retained for call-site compatibility. Whether closing
   *   erases anything is a rendering decision.
   */
  public stop(_clearLine: boolean = true): void {
    if (!this.spinnerActive) {
      return;
    }
    this.spinnerActive = false;
    this.progress_emit('complete');
  }

  /**
   * Revises the label of an open announcement.
   *
   * @param newMessage - The label to show from now on.
   */
  public updateMessage(newMessage: string): void {
    this.message = newMessage;
    if (this.spinnerActive) {
      this.progress_emit('working');
    }
  }

  /**
   * Emits one progress event for the current label.
   *
   * @param phase - The lifecycle phase this event reports.
   */
  private progress_emit(phase: 'working' | 'complete'): void {
    sink_get().progress_write({
      operation: 'task',
      kind: 'inspection',
      phase,
      label: this.message,
    });
  }
}

const globalSpinner: Spinner = new Spinner();
export { globalSpinner as spinner };
