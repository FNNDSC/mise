/**
 * @file What can be opened as text: the one list the kernel's edit and a
 * surface's EDIT both read.
 */
import { describe, it, expect } from '@jest/globals';
import { EDIT_CONFIRM_BYTES, editExtension_of, path_isEditable } from '../src/edit.js';

describe('path_isEditable', () => {
  it('takes text and refuses bytes, by extension', () => {
    expect(path_isEditable('/home/u/config.json')).toBe(true);
    expect(path_isEditable('/proc/jobs/feed_12/note')).toBe(true);
    expect(path_isEditable('/home/u/scan.DCM')).toBe(false);
    expect(path_isEditable('/home/u/brain.nii.gz')).toBe(false);
    expect(path_isEditable('/home/u/brain.nii')).toBe(false);
  });

  it('reads an extension lower case, with its dot, and none for a dotfile', () => {
    expect(editExtension_of('/a/B.YAML')).toBe('.yaml');
    expect(editExtension_of('/a/.hidden')).toBe('');
    expect(EDIT_CONFIRM_BYTES).toBe(1048576);
  });
});
