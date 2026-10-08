/**
 * @file The listing item: an open type, fields a backend adds are kept, the core fields are required.
 */
import { describe, it, expect } from '@jest/globals';
import { LISTING_ITEM_KINDS, listingItemSchema } from '../src/listing.js';

const base = { name: 'a', type: 'file', size: 1, owner: 'o', date: '2026-10-08' };

describe('listingItemSchema', () => {
  it('takes the kinds every filesystem lists and a backend\'s own kind alike', () => {
    expect(LISTING_ITEM_KINDS).toEqual(['dir', 'file', 'link', 'vfs']);
    for (const type of ['dir', 'file', 'link', 'vfs', 'plugin', 'job', 'cluster']) {
      expect(listingItemSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });

  it('keeps fields a backend adds, and the optional ones it knows', () => {
    const parsed = listingItemSchema.parse({ ...base, tags: ['t'], id: 7, region: 'iad' });
    expect(parsed).toMatchObject({ tags: ['t'], id: 7, region: 'iad' });
  });

  it('refuses an entry without its core fields', () => {
    expect(listingItemSchema.safeParse({ type: 'file', size: 1, owner: 'o', date: 'd' }).success).toBe(false);
    expect(listingItemSchema.safeParse({ ...base, size: '1' }).success).toBe(false);
  });
});
