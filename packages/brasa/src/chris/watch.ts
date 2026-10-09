/**
 * @file What the ChRIS backend watches for a surface: a feed's jobs, kept
 * live while any surface asks.
 *
 * @module
 */
import type { WatchState } from '@fnndsc/menu';
import type { Backend } from '../core/backend.js';
import { procWatch_add, procWatch_remove, procWatch_release, procWatch_state, watchSubject_parse } from '../builtins/procWatch.js';

/** The ChRIS backend's watch. */
export const chrisWatch: NonNullable<Backend['watch']> = {
  set: (subject: string, owner: string, on: boolean): WatchState | null => {
    const feedID: number | null = watchSubject_parse(subject);
    if (feedID === null) return null;
    if (on) return procWatch_add(feedID, owner);
    procWatch_remove(feedID, owner);
    return procWatch_state(feedID);
  },
  release: (owner: string): void => procWatch_release(owner),
};
