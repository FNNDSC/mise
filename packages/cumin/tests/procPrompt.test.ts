/**
 * @file Tests for the prompt-facing process-index lifecycle contract.
 *
 * @module
 */

import { describe, expect, it } from '@jest/globals';
import {
  PROC_PROMPT_STATES,
  procPromptState_get,
} from '../src/cache/procPrompt';

describe('process-index prompt state', (): void => {
  it('publishes the complete wire vocabulary', (): void => {
    expect(PROC_PROMPT_STATES).toEqual(['cold', 'cached', 'failed']);
  });

  it('prefers explicit lifecycle state', (): void => {
    expect(procPromptState_get({ loaded: 3, state: 'failed' })).toBe('failed');
  });

  it('derives compatibility state from the restored flag', (): void => {
    expect(procPromptState_get({ loaded: 3, restored: true })).toBe('cached');
    expect(procPromptState_get({ loaded: 3, restored: false })).toBe('cold');
  });
});
