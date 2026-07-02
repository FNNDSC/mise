/**
 * @file Non-destructive sorting helper for VFS items.
 *
 * @module
 */
import { VFSItem } from './provider.js';

/**
 * Sorts VFS items by a field (name/size/date/owner), non-destructively.
 *
 * Strings are compared with localeCompare, numbers numerically; mismatched or
 * unsupported types are left in their original relative order.
 *
 * @param items - Items to sort.
 * @param sortField - Field to sort by (default 'name').
 * @param reverse - Whether to reverse the resulting order.
 * @returns A new sorted array.
 */
export function vfsItems_sort(
  items: VFSItem[],
  sortField?: 'name' | 'size' | 'date' | 'owner',
  reverse?: boolean
): VFSItem[] {
  const field: keyof VFSItem = sortField || 'name';
  const sorted: VFSItem[] = [...items].sort((a: VFSItem, b: VFSItem) => {
    const valA: VFSItem[keyof VFSItem] = a[field];
    const valB: VFSItem[keyof VFSItem] = b[field];
    if (typeof valA === 'string' && typeof valB === 'string') {
      return valA.localeCompare(valB);
    }
    if (typeof valA === 'number' && typeof valB === 'number') {
      return valA - valB;
    }
    return 0;
  });
  if (reverse) {
    sorted.reverse();
  }
  return sorted;
}
