/**
 * @file A listing as a terminal shows it: `ls`'s grid and long views, and the
 * sort they are given.
 *
 * The core knows four kinds of item: files, folders, links and mounts. A
 * backend adds the kinds it lists (each with its long-view mark, and whether
 * it is a container) and says how a name is coloured; that is the listing's
 * look. A look with no colouring writes names plainly.
 *
 * @module
 */
import chalk from 'chalk';
import { VFSItem } from './provider.js';

/** How one kind of item shows in a listing. */
export interface ItemKindLook {
  /** The item type it describes. */
  readonly type: string;
  /** The long view's first column: `d` for a folder, `-` for a file. */
  readonly mark: string;
  /** Whether it holds other items: its name ends in `/`. */
  readonly container?: boolean;
  /**
   * What the long view shows in the size column, when it is not the size
   * (a job shows its status); null keeps the size.
   */
  readonly sizeColumn?: (item: VFSItem) => string | null;
}

/** How a listing shows: its kinds, and how a name is coloured. */
export interface ListingLook {
  /** The kinds it knows; a kind not here shows as a file. */
  readonly kinds: ReadonlyArray<ItemKindLook>;
  /** Colours one name by its type. */
  readonly name_colorize: (name: string, type: string) => string;
}

/** The kinds every listing knows. */
export const LISTING_CORE_KINDS: ReadonlyArray<ItemKindLook> = [
  { type: 'file', mark: '-' },
  { type: 'dir', mark: 'd', container: true },
  { type: 'link', mark: 'l' },
  { type: 'vfs', mark: 'v' },
];

/** The look of a listing with only the core's kinds and plain names. */
export const LISTING_LOOK_PLAIN: ListingLook = {
  kinds: LISTING_CORE_KINDS,
  name_colorize: (name: string): string => name,
};

/** The options a listing renders with. */
export interface ListingViewOptions {
  /** Sizes in B, KB, MB... rather than bytes. */
  human?: boolean;
  /** One name per line, as `ls -1`. */
  oneColumn?: boolean;
}

/**
 * Formats a byte count for people.
 *
 * @param bytes - The count.
 * @returns `0 B`, `1.5 KB`, `12 MB`...
 */
export function size_format(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k: number = 1024;
  const sizes: string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i: number = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Sorts a listing's items by one field, without changing the array given.
 *
 * Numbers compare numerically, strings by locale; an item missing the field
 * sorts after one that has it. `reverse` reverses each comparison, so items
 * that compare equal keep their order (unlike {@link vfsItems_sort}, which
 * reverses the sorted array).
 *
 * @param items - The items.
 * @param sortField - The field; none leaves the order as given.
 * @param reverse - Whether to sort descending.
 * @returns The items, sorted.
 */
export function listingItems_sort<T extends VFSItem>(items: T[], sortField?: string, reverse: boolean = false): T[] {
  if (!sortField || items.length === 0) {
    return items;
  }
  return [...items].sort((a: T, b: T): number => {
    const aVal: unknown = Reflect.get(a, sortField);
    const bVal: unknown = Reflect.get(b, sortField);
    if (aVal === undefined || aVal === null) return 1;
    if (bVal === undefined || bVal === null) return -1;
    let comparison: number;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (aVal instanceof Date && bVal instanceof Date) {
      comparison = aVal.getTime() - bVal.getTime();
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }
    return reverse ? -comparison : comparison;
  });
}

/**
 * The look of one kind.
 *
 * @param look - The listing's look.
 * @param type - The item's type.
 * @returns Its kind, or undefined for a kind the look does not know.
 */
function kind_find(look: ListingLook, type: string): ItemKindLook | undefined {
  return look.kinds.find((kind: ItemKindLook): boolean => kind.type === type);
}

/**
 * One item's name as a listing shows it: coloured, and ending in `/` when
 * it is a container.
 *
 * @param item - The item.
 * @param look - The listing's look.
 * @returns The name.
 */
function name_format(item: VFSItem, look: ListingLook): string {
  const base: string = look.name_colorize(item.name, item.type);
  return kind_find(look, item.type)?.container === true ? base + chalk.cyan.bold('/') : base;
}

/**
 * A string's length on screen, its ANSI codes left out.
 *
 * @param str - The string.
 * @returns How many columns it takes.
 */
function string_lengthVisible(str: string): number {
  return str.replace(/\u001b\[[0-9;]*m/g, '').length;
}

/**
 * Renders items as `ls` does: names in as many columns as the terminal holds.
 *
 * @param items - The items, already sorted.
 * @param options - The view options.
 * @param look - The listing's look.
 * @returns The grid.
 */
export function grid_render(items: VFSItem[], options: ListingViewOptions = {}, look: ListingLook = LISTING_LOOK_PLAIN): string {
  if (items.length === 0) return '';

  const formattedItems: string[] = items.map((item: VFSItem): string => {
    let str: string = name_format(item, look);
    if (item.version) str += chalk.dim(` (${item.version})`);
    return str;
  });

  if (options.oneColumn) {
    return formattedItems.join('\n');
  }

  const termWidth: number = process.stdout.columns || 80;
  const padding: number = 2;

  const maxLen: number = Math.max(...formattedItems.map(string_lengthVisible));
  // Cap colWidth at termWidth so padding never causes a terminal line wrap.
  const colWidth: number = Math.min(maxLen + padding, termWidth);
  const cols: number = Math.max(1, Math.floor(termWidth / colWidth));

  let output: string = '';
  for (let i: number = 0; i < formattedItems.length; i++) {
    const item: string = formattedItems[i];
    const visibleLen: number = string_lengthVisible(item);
    const padLen: number = Math.max(0, colWidth - visibleLen);

    output += item + ' '.repeat(padLen);

    if ((i + 1) % cols === 0) {
      output += '\n';
    }
  }

  return output.trimEnd();
}

/**
 * Renders items as `ls -l` does: one line each, with mark, owner, size,
 * date, name, and the title, tags and link target an item carries.
 *
 * @param items - The items, already sorted.
 * @param options - The view options.
 * @param look - The listing's look.
 * @returns The lines.
 */
export function long_render(items: VFSItem[], options: ListingViewOptions = {}, look: ListingLook = LISTING_LOOK_PLAIN): string {
  if (items.length === 0) return '';

  // Calculate max name width for alignment
  const maxNameWidth: number = Math.max(
    ...items.map((item: VFSItem): number => {
      const visibleLen: number = string_lengthVisible(name_format(item, look));
      return item.version ? visibleLen + item.version.length + 3 : visibleLen;
    }),
  );

  return items.map((item: VFSItem): string => {
    const kind: ItemKindLook | undefined = kind_find(look, item.type);
    const typeChar: string = kind?.mark ?? '-';
    const owner: string = item.owner.padEnd(10);

    const column: string | null = kind?.sizeColumn?.(item) ?? null;
    const sizeStr: string = column ?? (options.human ? size_format(item.size) : item.size.toString()).padEnd(8);

    // The date as `YYYY-MM-DD HH:mm:ss`, from an ISO string.
    const dateStr: string = item.date.replace('T', ' ').slice(0, 19);

    let nameStr: string = name_format(item, look);
    if (item.version) nameStr += ` (${item.version})`;

    // Pad name to max width for alignment
    const nameVisibleLen: number = string_lengthVisible(nameStr);
    const namePadding: string = ' '.repeat(Math.max(0, maxNameWidth - nameVisibleLen));

    let line: string = `${typeChar} ${owner} ${sizeStr} ${dateStr} ${nameStr}${namePadding}`;

    if (item.title) {
      line += `    ${chalk.greenBright(item.title)}`;
    }

    // Tags, as #tags after the title.
    if (item.tags !== undefined && item.tags.length > 0) {
      line += `    ${chalk.cyan(item.tags.map((tag: string): string => `#${tag}`).join(' '))}`;
    }

    if (item.type === 'link' && item.target) {
      line += ` -> ${item.target}`;
    }

    return line;
  }).join('\n');
}
