/**
 * @file The listing item: one entry of a directory listing, whatever serves it.
 *
 * Not one listing kind per thing that can be listed: one item shape whose
 * `type` says what the entry is. A directory and a file are what every
 * filesystem has; a backend lists its own kinds beside them (ChRIS lists
 * plugins, pipelines and jobs), so `type` is an open string. A surface draws
 * the kinds it knows and draws any other as a plain entry, rather than
 * refusing the listing (docs/menu.adoc, "One listing kind, discriminated
 * items").
 *
 * @module
 */
import { z } from 'zod';

/** The kinds every filesystem lists; a backend adds its own beside them. */
export const LISTING_ITEM_KINDS = ['dir', 'file', 'link', 'vfs'] as const;

/** One of the kinds every filesystem lists. */
export type ListingItemKind = (typeof LISTING_ITEM_KINDS)[number];

/**
 * One listing entry. Fields beyond these are kept: a backend may carry more
 * about an entry than the core reads.
 */
export const listingItemSchema = z
  .object({
    /** The entry's name, as listed. */
    name: z.string(),
    /** What the entry is: a directory, a file, a link, a mount, or a backend's own kind. */
    type: z.string(),
    /** Size in bytes. */
    size: z.number(),
    /** Who owns it. */
    owner: z.string(),
    /** When it was made (ISO 8601). */
    date: z.string(),
    /** Where a link points. */
    target: z.string().optional(),
    /** A versioned entry's version. */
    version: z.string().optional(),
    /** A title or description, when the entry has one. */
    title: z.string().optional(),
    /** Tags the entry carries, when the listing shows them. */
    tags: z.array(z.string()).optional(),
    /** The backing resource's id, when the entry stands for one. */
    id: z.number().optional(),
    /** A running entry's status. */
    status: z.string().optional(),
  })
  .passthrough();

/** One listing entry, as the engine builds it and a surface draws it. */
export interface ListingItem {
  name: string;
  type: string;
  size: number;
  owner: string;
  date: string;
  target?: string;
  version?: string;
  title?: string;
  tags?: string[];
  id?: number;
  status?: string;
  [key: string]: unknown;
}
