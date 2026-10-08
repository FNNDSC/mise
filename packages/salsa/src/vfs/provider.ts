/**
 * @file The virtual filesystem's contracts, re-exported from `@fnndsc/fond`.
 *
 * The provider interface, the item and the copy options belong to fond, which
 * holds the pieces every layer needs whatever the backend. salsa's mounts
 * implement them.
 *
 * @module
 */
export type { VFSProvider, VFSItem, CpOptions } from "@fnndsc/fond";
