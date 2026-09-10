/**
 * @file The verb roster: which controls a row offers, and when.
 *
 * Every listing that gives its rows verbs declares them here, once, and the
 * panes read this rather than each carrying its own list. Two things follow
 * from that. A pane cannot quietly stop offering a verb, because the verb
 * is not the pane's to forget. And a verb cannot quietly arrive, because
 * adding one means editing this file, where what it displaces is visible.
 *
 * This is not a test fixture. The panes build their action tracks from
 * these rules, so what the roster says and what an operator is offered are
 * the same statement; the test then asks a real listing what it renders and
 * holds it to the roster, exhaustively, in order.
 *
 * The rule owns the label and the condition. It never owns the doing: what
 * a verb runs needs the pane's own hands (a terminal, a session, a
 * retrieve), so a pane supplies `run` by the verb's name.
 *
 * Written after a verb went missing. GATHER, the control a whole workflow
 * starts with, stopped being offered on every series already in CUBE and
 * every test stayed green, because no test had ever asked a listing what it
 * offers.
 *
 * @module
 */

/** Every listing that offers its rows verbs. */
export type VerbListing =
  | 'files.row'
  | 'files.selection'
  | 'runs.row'
  | 'pacs.study'
  | 'pacs.series';

/**
 * One verb a row may be offered.
 *
 * @property name - Stable identity, what a pane binds its `run` to. Never shown.
 * @property label - What the operator reads; a count or a feed number makes it vary.
 * @property offered - Whether this row is offered the verb at all.
 */
export interface VerbRule<F> {
  name: string;
  label: (facts: F) => string;
  offered: (facts: F) => boolean;
}

/**
 * One listing's verbs, in the order a row shows them, and the row states
 * worth holding it to.
 *
 * @property listing - Which listing this is.
 * @property rules - The verbs, in track order.
 * @property states - Representative rows, named. The test walks these; they
 *   live here so the roster is one statement rather than two that can drift.
 */
export interface VerbRoster<F> {
  listing: VerbListing;
  rules: ReadonlyArray<VerbRule<F>>;
  states: ReadonlyArray<{ name: string; facts: F }>;
}

/** What a browser row is, as far as its verbs are concerned. */
export interface FileRowFacts {
  /** A catalogue entry is a plugin or a pipeline: listed, not stored. */
  kind: 'file' | 'directory' | 'seriesFolder' | 'catalogue';
  /** The feed the path names, when it names one. */
  feed: number | null;
}

/** What a browser selection is. */
export interface FilesSelectionFacts {
  count: number;
  /** The feeds the selection touches; sharing grants a feed, never a file. */
  feeds: readonly number[];
}

/** What a feed row is. A feed offers the same verbs whatever state it is in. */
export interface RunsRowFacts {
  feedId: number;
}

/** What a PACS study row is. */
export interface PacsStudyFacts {
  /** The study resolves to a VFS path, so it can be pulled. */
  addressable: boolean;
}

/** What a PACS series row is. */
export interface PacsSeriesFacts {
  /** CUBE already holds it. */
  inCube: boolean;
  /** CUBE has named the folder it landed in, so it can be opened as an image. */
  folderKnown: boolean;
  /** The series resolves to a VFS path, so a pull can name it. */
  addressable: boolean;
}

/** A browser row's verbs. A catalogue entry gets none: `rm` on a plugin cannot act. */
export const FILE_ROW_ROSTER: VerbRoster<FileRowFacts> = {
  listing: 'files.row',
  rules: [
    { name: 'image', label: (): string => 'IMAGE', offered: (f: FileRowFacts): boolean => f.kind === 'seriesFolder' },
    { name: 'download', label: (): string => 'DOWNLOAD', offered: (f: FileRowFacts): boolean => f.kind === 'file' },
    { name: 'move', label: (): string => 'MOVE', offered: (f: FileRowFacts): boolean => f.kind !== 'catalogue' },
    { name: 'copy', label: (): string => 'COPY', offered: (f: FileRowFacts): boolean => f.kind !== 'catalogue' },
    { name: 'delete', label: (): string => 'DELETE', offered: (f: FileRowFacts): boolean => f.kind !== 'catalogue' },
    {
      name: 'share',
      // The capsule NAMES the feed: CUBE grants a feed and never a file, so
      // a bare SHARE on a file row would read as a lie about what happens.
      label: (f: FileRowFacts): string => `SHARE FEED ${f.feed ?? ''}`,
      offered: (f: FileRowFacts): boolean => f.kind !== 'catalogue' && f.feed !== null,
    },
  ],
  states: [
    { name: 'a plain file outside a feed', facts: { kind: 'file', feed: null } },
    { name: 'a file inside a feed', facts: { kind: 'file', feed: 12 } },
    { name: 'a directory', facts: { kind: 'directory', feed: null } },
    { name: 'a DICOM series folder', facts: { kind: 'seriesFolder', feed: null } },
    { name: 'a catalogue entry', facts: { kind: 'catalogue', feed: null } },
  ],
};

/** A browser selection's verbs. */
export const FILES_SELECTION_ROSTER: VerbRoster<FilesSelectionFacts> = {
  listing: 'files.selection',
  rules: [
    { name: 'delete', label: (f: FilesSelectionFacts): string => `DELETE ${f.count}`, offered: (): boolean => true },
    { name: 'move', label: (f: FilesSelectionFacts): string => `MOVE ${f.count}`, offered: (): boolean => true },
    { name: 'copy', label: (f: FilesSelectionFacts): string => `COPY ${f.count}`, offered: (): boolean => true },
    {
      name: 'share',
      label: (f: FilesSelectionFacts): string =>
        (f.feeds.length === 1 ? `SHARE FEED ${f.feeds[0]}` : `SHARE ${f.feeds.length} FEEDS`),
      offered: (f: FilesSelectionFacts): boolean => f.feeds.length > 0,
    },
  ],
  states: [
    { name: 'a selection outside any feed', facts: { count: 3, feeds: [] } },
    { name: 'a selection in one feed', facts: { count: 2, feeds: [12] } },
    { name: 'a selection spanning feeds', facts: { count: 5, feeds: [12, 13] } },
  ],
};

/** A feed row's verbs. Sharing grants the feed; removal is the kernel's, and it asks. */
export const RUNS_ROW_ROSTER: VerbRoster<RunsRowFacts> = {
  listing: 'runs.row',
  rules: [
    { name: 'share', label: (): string => 'SHARE', offered: (): boolean => true },
    { name: 'delete', label: (): string => 'DELETE', offered: (): boolean => true },
  ],
  states: [{ name: 'any feed', facts: { feedId: 12 } }],
};

/** A PACS study row's verbs. */
export const PACS_STUDY_ROSTER: VerbRoster<PacsStudyFacts> = {
  listing: 'pacs.study',
  rules: [
    { name: 'pullStudy', label: (): string => 'PULL STUDY', offered: (f: PacsStudyFacts): boolean => f.addressable },
  ],
  states: [
    { name: 'a study with a path', facts: { addressable: true } },
    { name: 'a study with none', facts: { addressable: false } },
  ],
};

/**
 * A PACS series row's verbs.
 *
 * A series already home is gathered, not pulled, and opened as an image
 * once CUBE has said where it landed. One that carries no path is still
 * offered the pull and refused it, which says more than hiding it would.
 */
export const PACS_SERIES_ROSTER: VerbRoster<PacsSeriesFacts> = {
  listing: 'pacs.series',
  rules: [
    { name: 'gather', label: (): string => 'GATHER', offered: (f: PacsSeriesFacts): boolean => f.inCube },
    { name: 'image', label: (): string => 'IMAGE', offered: (f: PacsSeriesFacts): boolean => f.inCube && f.folderKnown },
    { name: 'pull', label: (): string => 'PULL', offered: (f: PacsSeriesFacts): boolean => !f.inCube },
  ],
  states: [
    { name: 'not yet retrieved', facts: { inCube: false, folderKnown: false, addressable: true } },
    { name: 'not retrieved and unaddressable', facts: { inCube: false, folderKnown: false, addressable: false } },
    { name: 'home, folder not yet named', facts: { inCube: true, folderKnown: false, addressable: true } },
    { name: 'home, folder named', facts: { inCube: true, folderKnown: true, addressable: true } },
  ],
};

/**
 * A roster whose row type is its own business, so they can be held in one
 * list and walked together. The same visitor idiom the listing façade uses
 * for a child level, and for the same reason: neither side needs to name
 * the other's rows.
 */
export interface AnyVerbRoster {
  listing: VerbListing;
  visit<R>(visitor: <F>(roster: VerbRoster<F>) => R): R;
}

/**
 * Hides a roster's row type behind a visitor.
 *
 * @param roster - The roster.
 * @returns It, walkable beside the others.
 */
export function verbRoster_any<F>(roster: VerbRoster<F>): AnyVerbRoster {
  return {
    listing: roster.listing,
    visit<R>(visitor: <X>(one: VerbRoster<X>) => R): R {
      return visitor(roster);
    },
  };
}

/** Every roster, for a test that means to hold the whole surface to them. */
export const VERB_ROSTERS: ReadonlyArray<AnyVerbRoster> = [
  verbRoster_any(FILE_ROW_ROSTER),
  verbRoster_any(FILES_SELECTION_ROSTER),
  verbRoster_any(RUNS_ROW_ROSTER),
  verbRoster_any(PACS_STUDY_ROSTER),
  verbRoster_any(PACS_SERIES_ROSTER),
];

/**
 * The labels a row in this state is offered, in track order.
 *
 * @param roster - The listing's roster.
 * @param facts - The row.
 * @returns The labels, in the order the row shows them.
 */
export function verbs_offered<F>(roster: VerbRoster<F>, facts: F): string[] {
  return roster.rules
    .filter((rule: VerbRule<F>): boolean => rule.offered(facts))
    .map((rule: VerbRule<F>): string => rule.label(facts));
}

/**
 * One rule by name, for a pane binding what the verb does.
 *
 * @param roster - The listing's roster.
 * @param name - The verb's stable name.
 * @returns The rule.
 * @throws {Error} When the roster does not declare that verb, which is a
 *   pane offering something the surface never agreed to.
 */
export function verbRule_get<F>(roster: VerbRoster<F>, name: string): VerbRule<F> {
  const rule: VerbRule<F> | undefined = roster.rules.find((one: VerbRule<F>): boolean => one.name === name);
  if (rule === undefined) throw new Error(`${roster.listing} declares no verb '${name}'`);
  return rule;
}
