/**
 * @file The dashboard's tiles: what each domain holds, asked of the session
 * at paint time, and the way into it.
 *
 * A module of the host: the host hands in its verbs (open the roster, open
 * home, ask the session) and the dashboard builds its blocks from them.
 */
import type { SessionNotes } from '@fnndsc/menu';
import type { ExecuteOutcome } from '../calypso/client.js';
import { DRAWER_CHORDS, VERB_LINES, type DrawerChord } from '../console/argusLang.js';
import type { FsListingEntry } from '../features/files/panel.js';
import { TILE_ABOUT } from '../features/launcher/about.js';
import type { LauncherRow, LauncherTile } from '../features/launcher/panel.js';
import type { GroupSnapshot } from './dormant.js';

/** What the dashboard asks of the host. */
export interface DashboardHooks {
  /** Asks the session a line, quietly. */
  ask: (line: string) => Promise<ExecuteOutcome>;
  /** Opens home. */
  home_open: () => void;
  /** Opens home and moves the session into a folder. */
  home_cd: (path: string) => void;
  desktops: () => GroupSnapshot[];
  desktop_restore: (id: string) => void;
  panes_open: () => void;
  keys_open: () => void;
  notes_open: () => void;
  /** The newest installed release's notes, from the session; null when it has none. */
  notes_latest: () => Promise<SessionNotes | null>;
  /** Whether the daemon's code on disk has moved since it started: its notes are the running one's. */
  daemon_stale: () => boolean;
  console_open: () => void;
  /** The session's composition's tiles, asked each time the dashboard paints; absent, the frame's alone. */
  contribution?: () => Promise<TileContribution>;
}

/**
 * What a composition adds to the dashboard: a lead tile that takes the wide
 * seat when it has more to say than home (its weight against home's
 * entries), and tiles placed after FILES and after PANES.
 */
export interface TileContribution {
  lead?: { tile: LauncherTile; weight: number };
  afterFiles: LauncherTile[];
  afterPanes: LauncherTile[];
}

/**
 * Builds the dashboard's tile source.
 *
 * @param hooks - The host's verbs.
 * @returns What the launcher calls to paint: the tiles, in reading order.
 */
export function dashboardTiles_build(hooks: DashboardHooks): () => Promise<ReadonlyArray<LauncherTile>> {
  return async (): Promise<ReadonlyArray<LauncherTile>> => {
    const [home, notes, contribution]: [ExecuteOutcome, SessionNotes | null, TileContribution] = await Promise.all([
      hooks.ask('ls ~'),
      hooks.notes_latest(),
      hooks.contribution?.() ?? Promise.resolve({ afterFiles: [], afterPanes: [] }),
    ]);
    let entries: FsListingEntry[] = [];
    let homePath: string = '~';
    for (const envelope of home.envelopes) {
      if (envelope.model?.kind !== 'fs.listing') continue;
      const listings = envelope.model.data as Array<{ path?: unknown; items?: unknown }>;
      const first = listings[0];
      if (first !== undefined && Array.isArray(first.items)) {
        entries = first.items as FsListingEntry[];
        if (typeof first.path === 'string') homePath = first.path;
      }
    }
    const folders: FsListingEntry[] = entries.filter((entry: FsListingEntry): boolean => entry.type === 'dir');
    const desktops: GroupSnapshot[] = hooks.desktops();

    const files: LauncherTile = {
      key: 'files', name: 'FILES', hue: '--harvestgold', numeral: '2',
      figures: [{ text: `${entries.length} ENTRIES` }],
      rows: folders.slice(0, 5).map((entry: FsListingEntry): LauncherRow => ({
        text: entry.name,
        open: (): void => hooks.home_cd(homePath.endsWith('/') ? `${homePath}${entry.name}` : `${homePath}/${entry.name}`),
      })),
      verb: 'OPEN HOME',
      about: TILE_ABOUT['files'],
      enter: (): void => hooks.home_open(),
    };
    const panes: LauncherTile = {
      key: 'panes', name: 'PANES', hue: '--butter', numeral: '6',
      figures: [{ text: desktops.length === 0 ? 'EMPTY' : `${desktops.length} DESKTOPS` }],
      rows: desktops.slice(0, 5).map((group: GroupSnapshot): LauncherRow => ({
        text: group.label,
        open: (): void => hooks.desktop_restore(group.id),
      })),
      verb: 'SEE DESKTOPS',
      about: TILE_ABOUT['panes'],
      enter: (): void => hooks.panes_open(),
    };
    const help: LauncherTile = {
      key: 'help', name: 'KEYS', hue: '--butter', numeral: '',
      figures: [{ text: `${DRAWER_CHORDS.length} KEYS` }, { text: `${VERB_LINES.length} VERBS` }],
      rows: DRAWER_CHORDS.slice(0, 5).map((chord: DrawerChord): LauncherRow => ({ text: `${chord.key.padEnd(6)} ${chord.does}`, open: (): void => hooks.keys_open() })),
      verb: 'OPEN THE KEYS',
      about: TILE_ABOUT['keys'],
      enter: (): void => hooks.keys_open(),
    };
    // What the installed releases changed: the daemon's notes, the newest
    // release's headlines. Behind a daemon whose code moved on disk the
    // block says so, since what it lists is the running one's.
    const release = notes?.releases[0];
    const changes = release?.entries.flatMap((entry) => entry.changes.filter((change) => !change.internal)) ?? [];
    const whatsNew: LauncherTile = {
      key: 'notes', name: "WHAT'S NEW", hue: '--butter', numeral: '',
      figures: release === undefined
        ? [{ text: 'NO NOTES' }]
        : [{ text: hooks.daemon_stale() ? 'AFTER RESTART' : (release.date ?? 'UNDATED') }, { text: `${changes.length} CHANGE${changes.length === 1 ? '' : 'S'}` }],
      rows: changes.slice(0, 3).map((change): LauncherRow => ({ text: `${change.package.padEnd(7)} ${change.headline}`, open: (): void => hooks.notes_open() })),
      verb: 'OPEN THE NOTES',
      about: TILE_ABOUT['notes'],
      enter: (): void => hooks.notes_open(),
    };
    // The console is a door too: the same session, typed.
    const console_: LauncherTile = {
      key: 'console', name: 'CONSOLE', hue: '--daybreak', numeral: '5',
      figures: [],
      rows: [],
      verb: 'OPEN THE CONSOLE',
      about: TILE_ABOUT['console'],
      enter: (): void => hooks.console_open(),
    };
    // The block with the most to say takes the wide seat.
    const lead: LauncherTile[] = contribution.lead === undefined ? [] : [contribution.lead.tile];
    const tail: LauncherTile[] = [...contribution.afterFiles, panes, ...contribution.afterPanes, help, whatsNew, console_];
    return contribution.lead !== undefined && contribution.lead.weight >= entries.length
      ? [...lead, files, ...tail]
      : [files, ...lead, ...tail];
  };
}
