/**
 * @file What kind of thing a listing row is, as the installed backend's look
 * says.
 *
 * The core knows folders, files, links and mounts. A backend lists kinds of
 * its own (ChRIS: a job; stratus: a compartment, a shape) and says in its
 * listing look which of them hold other items. The tools that must know
 * whether a row can be entered or read (`cd`, `ls`, `cat`) ask here, not a
 * list of type names, so a backend's containers are folders to every tool.
 *
 * @module
 */
import { LISTING_LOOK_PLAIN, itemType_isContainer as lookItemType_isContainer, type ListingLook } from '@fnndsc/fond';
import { backendInstalled_get } from './backend.js';

/** The installed backend's listing look, or the plain one. */
export function listingLook_get(): ListingLook {
  return backendInstalled_get()?.listingLook ?? LISTING_LOOK_PLAIN;
}

/**
 * Whether an item type holds other items: a folder, a mount, or a kind the
 * installed backend's look marks as a container.
 *
 * @param type - The item type.
 * @returns True for a container.
 */
export function itemType_isContainer(type: string): boolean {
  return lookItemType_isContainer(listingLook_get(), type);
}
