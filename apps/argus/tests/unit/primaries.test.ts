/**
 * @file The primaries: files is the frame's; a composition adds its domains.
 */
import { describe, it, expect } from '@jest/globals';
import { pane_isPrimary, primary_register } from '../../src/app/panes.js';

describe('the primaries', () => {
  it('are files, and the domains a composition registers, and nothing else', () => {
    expect(pane_isPrimary('files')).toBe(true);
    expect(pane_isPrimary('dag')).toBe(false);
    primary_register('dag');
    primary_register('pacs');
    expect(pane_isPrimary('dag')).toBe(true);
    expect(pane_isPrimary('pacs')).toBe(true);
    expect(pane_isPrimary('universe')).toBe(false);
    expect(pane_isPrimary('files-2')).toBe(false);
  });
});
