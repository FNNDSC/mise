/**
 * @file The GATHER pane: a cohort as a listing.
 *
 * What used to be a tray under the PACS results — checkboxes and a strip of
 * capsules — is a listing pane like every other: one block, the cohort row
 * over its series rows, declared into the listing façade. Membership IS the
 * row: a series is in the cohort because it is listed, and REMOVE takes it
 * out. The cohort's verbs (SAVE / EXPORT CSV / CREATE FEED / DISMISS) live
 * on the cohort row, a series' (REMOVE / IMAGE / PROCESS) on the series row,
 * both drawn in the frame's row zone as every listing's are.
 *
 * The pane is born beside the PACS workspace, joined to its group, when the
 * first series is gathered; it is the workspace's cohort made visible as a
 * place, so a viewer or a catalogue opened from a row here joins the same
 * group. DISMISS forgets the cohort on the surface only — a saved manifest
 * is a file in `~/gather`, removed from a browser like any file.
 *
 * @module
 */
import { Listing, listingChild_declare, type ListingStateParts } from '../roster/listing.js';
import type { ListingAction, ListingTrait } from '../roster/row.js';
import {
  GATHER_COHORT_ROSTER, GATHER_SERIES_ROSTER, verbRule_get,
  type GatherCohortFacts, type GatherSeriesFacts,
} from '../roster/verbs.js';

/** One gathered series: the cohort's unit, as the PACS row handed it over. */
export interface GatherSeries {
  seriesUID: string;
  description: string;
  modality: string;
  /** The patient it came from (MRN, else name), which the series alone does not know. */
  patient: string;
  /** The series as the kernel addresses it (`pull` takes this). */
  vfsPath: string;
  /** Its CFS folder once CUBE has said where it landed (IMAGE and PROCESS need it). */
  folderPath?: string;
  /** How many files it holds, when the PACS said. */
  files?: number;
}

/** What the pane asks of its host. */
export interface GatherPanelHandlers {
  /** Runs an instrument command silently. */
  command_run: (line: string) => void;
  /** Runs a command visibly in the console (the big, auditable actions). */
  command_show: (line: string) => void;
  /** Opens a series' folder as an image beside the pane. */
  image_open: (folderPath: string) => void;
  /** Opens a catalogue bound to a series' folder. */
  process_open: (folderPath: string) => void;
  /** Asks the cohort's name, once, with a suggestion to hand; null when abandoned. */
  name_ask: (suggest: string) => Promise<string | null>;
  /** Membership changed: the host re-lights what depends on it (the PACS rows' GATHER). */
  changed: () => void;
  /** DISMISS: forget the cohort on the surface — the host closes the pane. */
  dismiss: () => void;
  /**
   * Runs a feed-creating line the operator could have typed (echoed, run,
   * its answer written) and reads the feed it made; null when it made none.
   */
  feed_create: (line: string) => Promise<GatherFeed | null>;
  /** PROCESS on a cohort with a feed: a catalogue bound to the feed's root, so a run appends to it. */
  cohort_process: (binding: { input: string; feed: number; node: number }) => void;
  /** Opens the cohort's feed as a graph beside the pane. */
  feed_open: (feedId: number) => void;
}

/** The feed a cohort was rooted in: its id, and the root a run appends to. */
export interface GatherFeed {
  feedId: number;
  rootInstanceId: number;
  /** The root's data folder — what a run on the cohort takes as input. */
  path: string;
}

/** The one cohort row: the level above the series. */
interface CohortRow {
  key: string;
}

/** One series row: the cohort's unit. */
interface SeriesRow {
  entry: GatherSeries;
}

/** The cohort row's key; one cohort per pane. */
const COHORT_KEY: string = 'cohort';

/**
 * Quotes one CSV field: as is, or wrapped when it holds a comma, a quote
 * or a line break.
 *
 * @param value - The field.
 * @returns It, quoted if it needs it.
 */
function csvField_quote(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

/**
 * A note the field shows when it holds nothing.
 *
 * @param text - What it says.
 * @returns The element.
 */
function element_note(text: string): HTMLElement {
  const note: HTMLParagraphElement = document.createElement('p');
  note.className = 'files-empty';
  note.textContent = text;
  return note;
}

/** The GATHER pane controller. */
export class GatherPanel {
  private readonly handlers: GatherPanelHandlers;
  private readonly title: HTMLElement | null;
  private readonly entries: Map<string, GatherSeries> = new Map();
  /** The cohort's name once SAVE has asked it; null until then. */
  private name: string | null = null;
  /** The feed the cohort was rooted in, once CREATE FEED or PROCESS made one. */
  private feed: GatherFeed | null = null;
  private readonly listing: Listing<CohortRow>;
  private readonly cohortActions: ReadonlyArray<ListingAction<CohortRow>>;
  private readonly seriesActions: ReadonlyArray<ListingAction<SeriesRow>>;

  /**
   * @param root - The pane root, whose chrome (state span, FILTER pill) the façade finds.
   * @param mount - The `.gather-rows` element the listing renders into.
   * @param handlers - Host callbacks.
   */
  constructor(root: HTMLElement, mount: HTMLElement, handlers: GatherPanelHandlers) {
    this.handlers = handlers;
    this.title = root.querySelector<HTMLElement>('.gather-title');
    this.cohortActions = this.cohortActions_declare();
    this.seriesActions = this.seriesActions_declare();
    this.listing = new Listing<CohortRow>({
      mount,
      traits: this.cohortTraits_declare(),
      key: (row: CohortRow): string => row.key,
      chrome: { root, prefix: 'gather' },
      // The fold cell folds the cohort; its body puts the cohort's verbs in
      // the frame. A level of one opens itself, so the series show at once.
      // Always activatable: a row the façade cannot activate gets no click
      // at all, and an emptied cohort still has DISMISS to offer.
      control: 'fold',
      actions: { of: (): ReadonlyArray<ListingAction<CohortRow>> => this.cohortActions },
      row: {
        className: (): string => 'gather-cohort-row',
        groupClassName: (): string => 'gather-cohort',
        decorate: (element: HTMLElement): void => {
          element.title = 'the cohort: click for its verbs, the fold cell folds its series';
        },
      },
      child: listingChild_declare(
        (): ReadonlyArray<SeriesRow> => [...this.entries.values()].map((entry: GatherSeries): SeriesRow => ({ entry })),
        {
          traits: this.seriesTraits_declare(),
          key: (row: SeriesRow): string => row.entry.seriesUID,
          // A series is a leaf: a click indicates it and its verbs go to
          // the frame; activating it does nothing.
          actions: { of: (): ReadonlyArray<ListingAction<SeriesRow>> => this.seriesActions },
          row: {
            className: (): string => 'gather-series',
            decorate: (element: HTMLElement, row: SeriesRow): void => {
              element.dataset['seriesuid'] = row.entry.seriesUID;
            },
          },
        },
      ),
      state: (parts: ListingStateParts): string => this.stateLine_compose(parts),
      empty: (): HTMLElement => element_note('NOTHING GATHERED'),
    });
    this.render();
  }

  /** Whether the cohort holds this series. */
  public has(seriesUID: string): boolean {
    return this.entries.has(seriesUID);
  }

  /** The cohort, in gather order. */
  public entries_get(): ReadonlyArray<GatherSeries> {
    return [...this.entries.values()];
  }

  /** The cohort's name, when SAVE has asked it. */
  public name_get(): string | null {
    return this.name;
  }

  /** The feed the cohort was rooted in, when it was. */
  public feed_get(): GatherFeed | null {
    return this.feed;
  }

  /**
   * Records the cohort's feed (made here, or restored by a desktop): the
   * cohort row lights FEED N, and PROCESS appends from now on.
   *
   * @param feed - The feed, or null for none.
   */
  public feed_set(feed: GatherFeed | null): void {
    this.feed = feed;
    this.render();
  }

  /**
   * Names the cohort without asking (a desktop restoring what was named).
   *
   * @param name - The name, or null for unnamed.
   */
  public name_set(name: string | null): void {
    this.name = name;
    this.render();
  }

  /**
   * Adds a series to the cohort; one already there is left as it was.
   *
   * @param entry - The series.
   */
  public series_add(entry: GatherSeries): void {
    const held: GatherSeries | undefined = this.entries.get(entry.seriesUID);
    // A later hand-over may know the folder the first did not.
    this.entries.set(entry.seriesUID, held === undefined ? entry : { ...held, ...entry });
    this.render();
    this.handlers.changed();
  }

  /**
   * Takes a series out of the cohort.
   *
   * @param seriesUID - The series.
   */
  public series_remove(seriesUID: string): void {
    if (!this.entries.delete(seriesUID)) return;
    this.render();
    this.handlers.changed();
  }

  /** Paints the cohort as one block, its series open beneath it. */
  private render(): void {
    if (this.title !== null) {
      this.title.textContent = this.name === null ? 'GATHER' : `GATHER · ${this.name}`.toUpperCase();
    }
    this.listing.rows_set([{ key: 'gather', rows: [{ key: COHORT_KEY }] }], { field: 'gather' });
    if (this.entries.size > 0) this.listing.open_set(0, [COHORT_KEY]);
  }

  /**
   * The cohort row's columns: what it is called, how much it holds.
   *
   * @returns The traits, in cap order.
   */
  private cohortTraits_declare(): ReadonlyArray<ListingTrait<CohortRow>> {
    return [
      {
        key: 'fold',
        label: '',
        className: 'pacs-fold',
        capped: false,
        width: '5.2em',
        cell: (): HTMLElement => {
          const fold: HTMLSpanElement = document.createElement('span');
          fold.className = 'pacs-fold';
          return fold;
        },
      },
      {
        key: 'name',
        label: 'COHORT',
        className: 'gather-cohort-name',
        width: '1fr',
        cell: (): string => this.name ?? '(unnamed — SAVE names it)',
      },
      {
        key: 'series',
        label: 'SERIES',
        className: 'gather-cohort-count',
        width: '6em',
        cell: (): string => String(this.entries.size),
        compare: (): number => this.entries.size,
      },
      {
        key: 'patients',
        label: 'PATIENTS',
        className: 'gather-cohort-patients',
        width: '7em',
        cell: (): string => String(this.patients_count()),
        compare: (): number => this.patients_count(),
      },
      {
        // The feed the cohort landed in, as the catalogue's strip wears it:
        // a lit capsule that opens the feed's graph beside the pane.
        key: 'feed',
        label: 'FEED',
        className: 'gather-cohort-feed',
        width: '7em',
        cell: (): HTMLElement | string => {
          if (this.feed === null) return '—';
          const capsule: HTMLButtonElement = document.createElement('button');
          capsule.className = 'gather-feed listing-capsule listing-action-selected';
          capsule.textContent = `FEED ${this.feed.feedId}`;
          capsule.title = 'open the feed\'s graph beside the cohort';
          const feedId: number = this.feed.feedId;
          capsule.addEventListener('click', (event: Event): void => {
            event.stopPropagation();
            this.handlers.feed_open(feedId);
          });
          return capsule;
        },
        compare: (): number => this.feed?.feedId ?? -1,
      },
    ];
  }

  /**
   * A series row's columns: what it is, whose, how big.
   *
   * @returns The traits, in cap order.
   */
  private seriesTraits_declare(): ReadonlyArray<ListingTrait<SeriesRow>> {
    return [
      {
        key: 'description',
        label: 'SERIES',
        className: 'gather-series-desc',
        width: '1fr',
        cell: (row: SeriesRow): string => row.entry.description || row.entry.seriesUID,
        compare: (row: SeriesRow): string => row.entry.description || row.entry.seriesUID,
      },
      {
        key: 'modality',
        label: 'MODALITY',
        className: 'gather-series-modality',
        width: '6em',
        cell: (row: SeriesRow): string => row.entry.modality || '—',
      },
      {
        key: 'patient',
        label: 'MRN',
        className: 'gather-series-patient',
        width: '8em',
        cell: (row: SeriesRow): string => row.entry.patient || '—',
      },
      {
        key: 'files',
        label: 'FILES',
        className: 'gather-series-files',
        width: '5em',
        cell: (row: SeriesRow): string => (row.entry.files === undefined ? '—' : String(row.entry.files)),
        compare: (row: SeriesRow): number => row.entry.files ?? -1,
      },
      {
        key: 'state',
        label: 'STATE',
        className: 'gather-series-state',
        width: '7em',
        cell: (row: SeriesRow): string => (row.entry.folderPath === undefined ? 'listed' : 'in cube'),
      },
    ];
  }

  /**
   * The cohort's verbs, from its roster.
   *
   * @returns The actions, in capsule order.
   */
  private cohortActions_declare(): ReadonlyArray<ListingAction<CohortRow>> {
    const facts = (): GatherCohortFacts => ({ count: this.entries.size, feed: this.feed?.feedId ?? null });
    const runs: Record<string, () => void> = {
      save: (): void => { void this.manifest_save(); },
      export: (): void => { void this.cohort_export(); },
      feed: (): void => { void this.feed_ensure(); },
      process: (): void => { void this.cohort_process(); },
      dismiss: (): void => this.handlers.dismiss(),
    };
    return GATHER_COHORT_ROSTER.rules.map((rule): ListingAction<CohortRow> => ({
      label: rule.label(facts()),
      offered: (): boolean => rule.offered(facts()),
      run: (): void => runs[rule.name]?.(),
    }));
  }

  /**
   * A series' verbs, from its roster.
   *
   * @returns The actions, in capsule order.
   */
  private seriesActions_declare(): ReadonlyArray<ListingAction<SeriesRow>> {
    const facts = (row: SeriesRow): GatherSeriesFacts => ({ folderKnown: row.entry.folderPath !== undefined });
    const runs: Record<string, (row: SeriesRow) => void> = {
      remove: (row: SeriesRow): void => this.series_remove(row.entry.seriesUID),
      image: (row: SeriesRow): void => {
        if (row.entry.folderPath !== undefined) this.handlers.image_open(row.entry.folderPath);
      },
      process: (row: SeriesRow): void => {
        if (row.entry.folderPath !== undefined) this.handlers.process_open(row.entry.folderPath);
      },
    };
    return GATHER_SERIES_ROSTER.rules.map((rule): ListingAction<SeriesRow> => ({
      label: rule.label({ folderKnown: true }),
      offered: (row: SeriesRow): boolean => rule.offered(facts(row)),
      run: (row: SeriesRow): void => runs[rule.name]?.(row),
    }));
  }

  /** How many distinct patients the cohort spans. */
  private patients_count(): number {
    return new Set([...this.entries.values()].map((entry: GatherSeries): string => entry.patient)).size;
  }

  /**
   * The bar's summary: how much is gathered, then the façade's filter word.
   *
   * @param parts - The façade's typed state parts.
   * @returns The line.
   */
  private stateLine_compose(parts: ListingStateParts): string {
    const words: string[] = [`${this.entries.size} SERIES · ${this.patients_count()} PATIENTS`];
    if (parts.filter !== '') words.push(parts.filter);
    return words.join('  ·  ');
  }

  /**
   * The cohort's name, asked once (pre-filled with the name it has, else a
   * dated one) and kept; null when the operator abandoned the ask.
   *
   * @returns The name.
   */
  private async name_ensure(): Promise<string | null> {
    if (this.name !== null) return this.name;
    const answered: string | null = await this.handlers.name_ask(`gather-${new Date().toISOString().slice(0, 10)}`);
    const wanted: string = (answered ?? '').trim();
    if (wanted === '') return null;
    this.name = wanted;
    this.render();
    return wanted;
  }

  /** Writes the cohort manifest to `~/gather/<name>.json`, one visible command. */
  private async manifest_save(): Promise<void> {
    if (this.entries.size === 0) return;
    const name: string | null = await this.name_ensure();
    if (name === null) return;
    const manifest: string = JSON.stringify({
      name,
      gatheredAt: new Date().toISOString(),
      series: [...this.entries.values()].map((entry: GatherSeries) => ({
        seriesUID: entry.seriesUID,
        description: entry.description,
        modality: entry.modality,
        patient: entry.patient,
        vfsPath: entry.vfsPath,
      })),
    });
    this.handlers.command_run('mkdir ~/gather');
    this.handlers.command_show(`touch --withContents '${manifest}' ~/gather/${name}.json`);
  }

  /**
   * Writes the cohort as a table a spreadsheet reads, into CFS (the engine
   * is elsewhere; a redirect would write somebody else's disk).
   */
  private async cohort_export(): Promise<void> {
    if (this.entries.size === 0) return;
    const name: string | null = await this.name_ensure();
    if (name === null) return;
    const rows: string[] = [
      ['patient', 'series', 'modality', 'seriesUID', 'path'].join(','),
      ...[...this.entries.values()].map((entry: GatherSeries): string => [
        entry.patient, entry.description, entry.modality, entry.seriesUID, entry.vfsPath,
      ].map(csvField_quote).join(',')),
    ];
    this.handlers.command_run('mkdir ~/gather');
    this.handlers.command_show(`touch --withContents '${rows.join('\n')}' ~/gather/${name}.csv`);
  }

  /**
   * The cohort's feed: the one it has, else one rooted on it now by one
   * visible, auditable command (pull is idempotent, so series already home
   * confirm rather than re-fetch), named at the ask if it was not yet.
   *
   * @returns The feed, or null when none was made.
   */
  private async feed_ensure(): Promise<GatherFeed | null> {
    if (this.feed !== null) return this.feed;
    if (this.entries.size === 0) return null;
    const name: string | null = await this.name_ensure();
    if (name === null) return null;
    const paths: string = [...this.entries.values()].map((entry: GatherSeries): string => entry.vfsPath).join(' ');
    const made: GatherFeed | null = await this.handlers.feed_create(`pull --new-feed "${name}" ${paths}`);
    if (made !== null) this.feed_set(made);
    return made;
  }

  /**
   * PROCESS on the cohort: its feed first (made if there is none), then a
   * catalogue bound to the feed's root — a run appends to the cohort.
   */
  private async cohort_process(): Promise<void> {
    const feed: GatherFeed | null = await this.feed_ensure();
    if (feed === null) return;
    this.handlers.cohort_process({ input: feed.path, feed: feed.feedId, node: feed.rootInstanceId });
  }
}
