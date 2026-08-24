/**
 * @file Bridge between salsa VFS items and chili listing view models.
 *
 * Kept as a leaf module (type-only imports) so consumers like wildcard
 * expansion and tab completion can use the conversion without pulling the
 * whole VFS router into their module graph.
 *
 * @module
 */
import type { ListingItem } from '@fnndsc/chili/models/listing.js';
import type { VFSItem } from '@fnndsc/salsa';

/**
 * Converts salsa VFS items into chili listing view models.
 *
 * The two shapes are field-identical, but ListingItem carries an index
 * signature (SimpleRecord) that VFSItem does not declare, so the bridge is a
 * real per-item copy rather than a cast.
 *
 * @param items - Items from a vfsDispatcher listing.
 * @returns The same items as ListingItem view models.
 */
export function listingItems_fromVfs(items: VFSItem[]): ListingItem[] {
  return items.map((item: VFSItem): ListingItem => ({ ...item }));
}
