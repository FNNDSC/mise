/**
 * @file The dashboard's tiles: what each domain holds, asked of the session
 * at paint time, and the way into it.
 *
 * A module of the host: the host hands in its verbs (open the roster, open
 * home, ask the session) and the dashboard builds its blocks from them.
 */
import { feedListModelSchema, FEED_LIST_MODEL_KIND, type SessionNotes } from '@fnndsc/menu';
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
  universe_show: () => void;
  /** Opens the roster, optionally filtered. */
  runs_show: (filter?: string) => void;
  /** Opens the roster at one feed. */
  feed_enter: (feedId: number) => void;
  /** Opens home. */
  home_open: () => void;
  /** Opens home and moves the session into a folder. */
  home_cd: (path: string) => void;
  /** Drops a line into the console, ready to finish. */
  line_offer: (line: string) => void;
  /** What the PACS pane last asked, or empty. */
  pacs_query: () => string;
  pacs_open: () => void;
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
}

/**
 * Builds the dashboard's tile source.
 *
 * @param hooks - The host's verbs.
 * @returns What the launcher calls to paint: the tiles, in reading order.
 */
export function dashboardTiles_build(hooks: DashboardHooks): () => Promise<ReadonlyArray<LauncherTile>> {
  return async (): Promise<ReadonlyArray<LauncherTile>> => {
    const [roster, home, notes]: [ExecuteOutcome, ExecuteOutcome, SessionNotes | null] = await Promise.all([
      hooks.ask('proc feeds'),
      hooks.ask('ls ~'),
      hooks.notes_latest(),
    ]);
    interface RosterFeed { id: number; title: string; status: string }
    let feeds: RosterFeed[] = [];
    for (const envelope of roster.envelopes) {
      const model = envelope.model;
      if (model === undefined || model.kind !== FEED_LIST_MODEL_KIND) continue;
      const parsed = feedListModelSchema.safeParse(model.data);
      if (parsed.success) feeds = parsed.data.feeds as RosterFeed[];
    }
    // A roster refused for warming is not an empty roster: the tiles say
    // the index is warming rather than counting feeds that are not yet known.
    const rosterWarming: boolean = feeds.length === 0 && roster.envelopes.some((envelope): boolean => envelope.status === 'error');
    const feedsFigure: string = rosterWarming ? 'INDEX WARMING' : `${feeds.length} FEEDS`;
    const errored: number = feeds.filter((feed: RosterFeed): boolean => /error/i.test(feed.status)).length;
    const live: number = feeds.filter((feed: RosterFeed): boolean => /running|scheduled|created|started/i.test(feed.status)).length;
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

    const universe: LauncherTile = {
      key: 'universe', name: 'UNIVERSE', hue: '--honey', numeral: '',
      figures: [{ text: feedsFigure }],
      rows: [],
      verb: 'SEE THE SPACE',
      about: TILE_ABOUT['universe'],
      enter: (): void => hooks.universe_show(),
    };
    const analyses: LauncherTile = {
      key: 'analyses', name: 'ANALYSES', hue: '--october-sunset', numeral: '3',
      figures: [
        { text: feedsFigure },
        ...(live > 0 ? [{ text: `${live} RUNNING` }] : []),
        ...(errored > 0 ? [{ text: `${errored} ERRORED`, errored: true, open: (): void => hooks.runs_show('status:error') }] : []),
      ],
      rows: feeds.slice(0, 6).map((feed: RosterFeed): LauncherRow => ({
        text: `${feed.id}  ${feed.title}`,
        errored: /error/i.test(feed.status),
        open: (): void => hooks.feed_enter(feed.id),
      })),
      verb: 'OPEN THE ROSTER',
      about: TILE_ABOUT['analyses'],
      enter: (): void => hooks.runs_show(),
    };
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
    const pacsAnswer: string = hooks.pacs_query();
    const pacs: LauncherTile = {
      key: 'pacs', name: 'PACS', hue: '--daybreak', numeral: '4',
      figures: [{ text: pacsAnswer === '' ? 'NO ANSWER' : 'ANSWERED' }],
      // With nothing asked yet the block teaches instead of apologising:
      // the line it would take, dropped into the console ready to finish.
      rows: pacsAnswer === ''
        ? [
          { text: 'pacs query PatientID:…', open: (): void => hooks.line_offer('pacs query PatientID:') },
          { text: 'pacs query AccessionNumber:…', open: (): void => hooks.line_offer('pacs query AccessionNumber:') },
        ]
        : [{ text: pacsAnswer.slice(0, 48) }],
      verb: 'ASK A PACS',
      about: TILE_ABOUT['pacs'],
      enter: (): void => hooks.pacs_open(),
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
    const rest: LauncherTile[] = [files, pacs, panes, universe, help, whatsNew, console_];
    return feeds.length >= entries.length ? [analyses, ...rest] : [files, analyses, pacs, panes, universe, help, whatsNew, console_];
  };
}
