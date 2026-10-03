/**
 * @file The runs roster's rows: its columns, declared once with their grid
 * tracks, a feed's title cell with the marks of its tags, and the progress
 * and figure formats its cells read. The DAG panel declares the roster into
 * the listing façade with these.
 *
 * @module
 */
import type { FeedListEntry } from '@fnndsc/menu';
import { progressCell_build, type ListingProgress, type ListingTrait } from '../roster/row.js';

/**
 * A feed's progress, from the job counters that come with its row.
 *
 * @param feed - The roster row.
 * @returns Its progress, or null when the daemon reported no counts.
 */
export function feedProgress_of(feed: FeedListEntry): ListingProgress | null {
  if (feed.jobsTotal === undefined || feed.jobsDone === undefined) return null;
  const failed: boolean = feed.status === 'finishedWithError' || feed.status === 'cancelled';
  // The nodes that finished cleanly, when the daemon reported the errored
  // count: an errored feed's bar fills to these, not to every settled node.
  const succeeded: number | undefined = feed.jobsErrored === undefined ? undefined : feed.jobsDone - feed.jobsErrored;
  return {
    done: feed.jobsDone,
    total: feed.jobsTotal,
    ...(failed ? { failed: true } : {}),
    ...(succeeded !== undefined ? { succeeded } : {}),
  };
}

/**
 * The runs roster's columns, declared once, each with its grid track.
 *
 * Identity, description, then PROGRESS as the one expanse — a running feed
 * says how far it has got without anyone opening it, and the bar is what
 * the eye scans, so it takes the middle of the row — then the trailing
 * facts. Every other track is a fixed length: a row is its own grid, and a
 * track sized to its content would size per row and jog every column after
 * it. Totals are derived from resident nodes, so a feed not yet resident
 * reads a dash and sorts below every known value rather than as a zero.
 */

/**
 * A feed's title cell: its title, then a mark per tag it wears.
 *
 * @param feed - The roster row.
 * @returns The title as text when it wears no tag, else the cell with its marks.
 */
export function feedTitle_build(feed: FeedListEntry): string | HTMLElement {
  const title: string = feed.title || '(untitled)';
  const tags: ReadonlyArray<string> = feed.tags ?? [];
  if (tags.length === 0) return title;
  const cell: HTMLSpanElement = document.createElement('span');
  cell.className = 'feedlist-title feedlist-titled';
  const text: HTMLSpanElement = document.createElement('span');
  text.className = 'feedlist-title-text';
  text.textContent = title;
  cell.append(text);
  for (const tag of tags) {
    const mark: HTMLSpanElement = document.createElement('span');
    mark.className = 'feedlist-tag';
    mark.dataset['tag'] = tag;
    mark.title = `tag:${tag} — press to filter the roster by it`;
    mark.textContent = `#${tag}`;
    const remove: HTMLSpanElement = document.createElement('span');
    remove.className = 'feedlist-tag-x';
    remove.title = `take ${tag} off this feed (setfattr -x)`;
    remove.textContent = '×';
    mark.append(remove);
    cell.append(mark);
  }
  return cell;
}

export const FEED_TRAITS: ReadonlyArray<ListingTrait<FeedListEntry>> = [
  {
    // The row's control, as the browser's and PACS's: OPEN enters the
    // feed; the rest of the row selects it and puts its verbs in the frame.
    key: 'control',
    label: '',
    className: 'feedlist-control',
    capped: false,
    width: '5.2em',
    cell: (): HTMLElement => {
      const cell: HTMLSpanElement = document.createElement('span');
      cell.className = 'feedlist-control listing-capsule';
      cell.textContent = 'OPEN';
      return cell;
    },
  },
  {
    key: 'id',
    label: 'ID',
    className: 'feedlist-id',
    width: '4em',
    cell: (feed: FeedListEntry): string => String(feed.id),
    compare: (feed: FeedListEntry): number => feed.id,
  },
  {
    key: 'title',
    label: 'TITLE',
    className: 'feedlist-title',
    width: '24em',
    // The feed's tags are marks after its title, not a column: a press on
    // one filters the roster by it, and its × (on the indicated row) takes it off.
    cell: (feed: FeedListEntry): string | HTMLElement => feedTitle_build(feed),
    compare: (feed: FeedListEntry): string => feed.title,
  },
  {
    key: 'progress',
    label: 'PROGRESS',
    className: 'feedlist-progress',
    width: '1fr',
    // A feed with nothing scheduled still gets a track: nothing has
    // happened yet reads differently from there is nothing here.
    cell: (feed: FeedListEntry): HTMLElement => progressCell_build(feedProgress_of(feed)),
    compare: (feed: FeedListEntry): number => {
      const progress: ListingProgress | null = feedProgress_of(feed);
      if (progress === null || progress.total === 0) return -1;
      return progress.done / progress.total;
    },
  },
  {
    key: 'status',
    label: 'STATUS',
    className: 'feedlist-status',
    width: '8em',
    cell: (feed: FeedListEntry): string => feed.status.toUpperCase(),
    compare: (feed: FeedListEntry): string => feed.status,
  },
  {
    key: 'nodes',
    label: 'NODES',
    className: 'feedlist-nodes',
    width: '4em',
    cell: (feed: FeedListEntry): string => (feed.jobsTotal === undefined ? '—' : String(feed.jobsTotal)),
    compare: (feed: FeedListEntry): number => feed.jobsTotal ?? -1,
  },
  {
    key: 'sizeBytes',
    label: 'SIZE',
    className: 'feedlist-size',
    width: '5.5em',
    cell: (feed: FeedListEntry): string => (feed.sizeBytes === undefined ? '—' : size_format(feed.sizeBytes)),
    compare: (feed: FeedListEntry): number => feed.sizeBytes ?? -1,
  },
  {
    key: 'wallSeconds',
    label: 'TIME',
    className: 'feedlist-time',
    width: '6em',
    cell: (feed: FeedListEntry): string => (feed.wallSeconds === undefined ? '—' : duration_format(feed.wallSeconds)),
    compare: (feed: FeedListEntry): number => feed.wallSeconds ?? -1,
  },
  {
    key: 'owner',
    label: 'OWNER',
    className: 'feedlist-owner',
    width: '7em',
    cell: (feed: FeedListEntry): string => feed.owner,
  },
  {
    key: 'createdAt',
    label: 'CREATED',
    className: 'feedlist-created',
    width: '7em',
    cell: (feed: FeedListEntry): string => feed.createdAt.slice(0, 10),
    compare: (feed: FeedListEntry): string => feed.createdAt,
  },
];

/**
 * Formats a wall-clock duration for the facts chip.
 *
 * @param seconds - The duration in seconds.
 * @returns The human form (e.g. `42s`, `4m 12s`, `2h 05m`).
 */
export function duration_format(seconds: number): string {
  const whole: number = Math.round(seconds);
  if (whole < 60) {
    return `${whole}s`;
  }
  if (whole < 3600) {
    return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(whole / 3600)}h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * Formats a byte count for the facts chip, compactly.
 *
 * @param bytes - The size in bytes.
 * @returns The human form (e.g. `2.4K`, `13M`).
 */
export function size_format(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  const units: string[] = ['K', 'M', 'G', 'T'];
  let value: number = bytes;
  let unitIndex: number = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex = unitIndex + 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[unitIndex]}`;
}
