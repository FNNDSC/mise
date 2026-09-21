/**
 * @file Tests for the progress renderer seam: the vocabulary reaches
 * importers at its familiar name, and the headless default drops events.
 */
import { describe, it, expect } from '@jest/globals';
import { NullProgressRenderer, PROGRESS_OPERATIONS, PROGRESS_STATUSES, type ProgressEvent } from '../src/core/progress.js';

describe('progress seam', () => {
  it('re-exports the wire vocabulary', () => {
    expect(PROGRESS_OPERATIONS.length).toBeGreaterThan(0);
    expect(PROGRESS_STATUSES.length).toBeGreaterThan(0);
  });

  it('drops every event when no frontend renders progress', () => {
    const renderer: NullProgressRenderer = new NullProgressRenderer();
    const event: ProgressEvent = { operation: PROGRESS_OPERATIONS[0], status: PROGRESS_STATUSES[0] } as unknown as ProgressEvent;
    expect(() => renderer.write(event)).not.toThrow();
  });
});
