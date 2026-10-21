/**
 * @file A backend's container kinds are folders to every tool: the core asks
 * the installed look, not a list of type names.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { LISTING_CORE_KINDS } from '@fnndsc/fond';
import { backend_install, backendInstalled_get } from '../src/core/backend.js';
import { itemType_isContainer, listingLook_get } from '../src/core/itemKinds.js';
import { nullBackend_make } from '../src/null/backend.js';

describe('itemType_isContainer', () => {
  const before = backendInstalled_get();
  afterEach(() => { if (before !== null) backend_install(before); });

  it('with no look installed, folders and mounts are containers and nothing else is', () => {
    backend_install(nullBackend_make());
    expect(listingLook_get().kinds).toEqual(LISTING_CORE_KINDS);
    expect(itemType_isContainer('dir')).toBe(true);
    expect(itemType_isContainer('vfs')).toBe(true);
    expect(itemType_isContainer('job')).toBe(false);
    expect(itemType_isContainer('compartment')).toBe(false);
  });

  it('a backend look marks its own containers: a compartment is a folder, a shape is not', () => {
    const base = nullBackend_make();
    backend_install({
      ...base,
      listingLook: {
        kinds: [...LISTING_CORE_KINDS, { type: 'compartment', mark: 'c', container: true }, { type: 'shape', mark: 's' }],
        name_colorize: (name: string): string => name,
      },
    });
    expect(itemType_isContainer('compartment')).toBe(true);
    expect(itemType_isContainer('shape')).toBe(false);
    expect(itemType_isContainer('dir')).toBe(true);
  });
});
