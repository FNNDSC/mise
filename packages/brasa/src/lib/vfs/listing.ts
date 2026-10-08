/**
 * @file Bridge between the filesystem's items (fond's `VFSItem`) and the
 * listing's wire model (menu's `ListingItem`).
 *
 * Kept as a leaf module (type-only imports) so consumers like wildcard
 * expansion and tab completion can use the conversion without pulling the
 * whole VFS router into their module graph.
 *
 * @module
 */
import type { ListingItem } from '@fnndsc/menu';
import type { VFSItem } from '@fnndsc/salsa';

/**
 * Converts filesystem items into listing items.
 *
 * Every VFSItem field is a ListingItem field; ListingItem also carries an
 * index signature (a backend may add fields) that VFSItem does not declare,
 * so the bridge is a real per-item copy rather than a cast.
 *
 * @param items - Items from a vfsDispatcher listing.
 * @returns The same items as ListingItem view models.
 */
export function listingItemsFromVfs_make(items: VFSItem[]): ListingItem[] {
  return items.map((item: VFSItem): ListingItem => ({ ...item }));
}
