/**
 * @file The PACS workspace: query, retrieve, gather, materialize.
 *
 * Pull is selection, not the destination. The operator roams the search
 * space query by query, pulling series into a **gather** — a cohort under
 * construction. The tray reviews and curates it; materializing writes a
 * `~/gather/<name>` manifest and can root a new feed on the cohort in one
 * command — PACS Q/R as the front door of the data-state machine.
 *
 * Everything lowers to commands: the form regenerates an *editable*
 * `pacs query ...` line (run as edited); a series' PULL runs
 * `pull <series-vfs-path>`; CREATE FEED runs `pull --new-feed` over the
 * curated paths — idempotent, so already-retrieved series simply confirm.
 * Retrieve progress arrives on the typed progress channel, keyed by series
 * UID, and drives the row badges.
 *
 * A query's answer is a LISTING, and it is the same listing the file
 * browser and the runs roster are: columns declared once, a frame that
 * sorts and filters, actions outside the grid, progress at every level. It
 * differs only in mode — a study **folds** its series open in place rather
 * than replacing itself with them, which is what levels mean when the
 * level above is still worth seeing.
 *
 * @module
 */
import {
  pacsQueryModelSchema,
  PACS_QUERY_MODEL_KIND,
  type PacsProvenance,
  type PacsQueryModel,
  type PacsSeries,
  type PacsStudy,
  type WireEnvelope,
} from '@fnndsc/menu';
import type { ProgressMessage } from '../../calypso/client.js';
import { RosterOrder } from '../roster/order.js';
import { ListingHost } from '../roster/host.js';
import {
  actionCell_build, expansion_isOpen, expansion_toggle, listingRow_build,
  progress_aggregate, progressCell_build, traitColumns_of, traitValue_of,
  type Expansion, type ListingAction, type ListingProgress, type ListingTrait,
} from '../roster/row.js';

/** What the workspace asks of its host. */
export interface PacsPanelHandlers {
  /** Runs an instrument command silently. */
  command_run: (line: string) => void;
  /** Runs a command visibly in the console (the big, auditable actions). */
  command_show: (line: string) => void;
  /** The mars pill: dismiss this workspace. */
  workspace_close: () => void;
}

/** One gathered series: the cohort's unit. */
interface GatherEntry {
  seriesUID: string;
  description: string;
  modality: string;
  patient: string;
  vfsPath: string;
  selected: boolean;
}

/**
 * One row of the series listing: the series, and the study it belongs to.
 *
 * A row carries its parent because its verbs need it — gathering a series
 * records the patient it came from, which the series alone does not know.
 */
interface SeriesRow {
  study: PacsStudy;
  studyKey: string;
  series: PacsSeries;
}

/** One row of the study listing: the level above the series. */
interface StudyRow {
  study: PacsStudy;
  key: string;
}

/** What a series' badge is currently saying. */
interface BadgeState {
  status: string;
  current?: number;
  total?: number;
}

/**
 * The form fields and the query terms they lower to, in the STUDY caps'
 * order — the form stands where the answer will, so a term sits in the
 * column it fills and the generated line reads left to right as the
 * listing does.
 */
const FORM_TERMS: ReadonlyArray<{ id: string; term: string }> = [
  { id: 'pacs-f-name', term: 'PatientName' },
  { id: 'pacs-f-mrn', term: 'PatientID' },
  { id: 'pacs-f-date', term: 'StudyDate' },
  { id: 'pacs-f-accession', term: 'AccessionNumber' },
  { id: 'pacs-f-modality', term: 'Modality' },
];

/** Progress statuses worth a badge, mapped to badge text. */
const BADGE_TEXT: Readonly<Record<string, string>> = {
  running: 'RETRIEVING',
  done: '✓ PULLED',
  error: '✗ ERROR',
  unconfirmed: '? UNCONFIRMED',
  stalled: 'STALLED',
  queued: 'QUEUED',
  idle: 'NOT RETRIEVED',
};

/** What re-asking lowers to. */
const FRESH_FLAG: string = '--fresh';

/** Matches the flag anywhere on the line, so it is never doubled. */
const FRESH_FLAG_PATTERN: RegExp = /\s*--fresh\b/;

/**
 * How long ago something was, in the coarsest true unit.
 *
 * The elapsed time is the half an operator acts on — three months reaches
 * for RE-QUERY where four hours does not — while the date beside it is the
 * half worth quoting into a note. Neither is a judgement the surface makes.
 *
 * @param at - An ISO timestamp.
 * @returns A phrase like `3 MONTHS AGO`, or null when the stamp is unusable.
 */
function elapsed_describe(at: string): string | null {
  const then: number = Date.parse(at);
  if (Number.isNaN(then)) return null;
  const seconds: number = Math.max(0, Math.round((Date.now() - then) / 1000));
  const units: ReadonlyArray<{ limit: number; size: number; name: string }> = [
    { limit: 60, size: 1, name: 'SECOND' },
    { limit: 3600, size: 60, name: 'MINUTE' },
    { limit: 86400, size: 3600, name: 'HOUR' },
    { limit: 2592000, size: 86400, name: 'DAY' },
    { limit: 31536000, size: 2592000, name: 'MONTH' },
    { limit: Infinity, size: 31536000, name: 'YEAR' },
  ];
  for (const unit of units) {
    if (seconds >= unit.limit) continue;
    const count: number = Math.max(1, Math.floor(seconds / unit.size));
    return `${count} ${unit.name}${count === 1 ? '' : 'S'} AGO`;
  }
  return null;
}

/**
 * A study keeps its place and opens its series inside it.
 *
 * The other two panes `replace`: entering a directory or a feed leaves the
 * level above behind. A PACS result cannot, because the operator is
 * comparing studies while reading one — so the parent stays on stage.
 */
const STUDY_EXPANSION: 'fold' = 'fold';

/**
 * The PACS workspace controller.
 */
export class PacsPanel {
  private readonly root: HTMLElement;
  private readonly command: HTMLInputElement;
  private readonly results: HTMLElement;
  private readonly gatherRows: HTMLElement;
  private readonly gatherName: HTMLInputElement;
  private readonly handlers: PacsPanelHandlers;
  private readonly gather: Map<string, GatherEntry> = new Map();
  private readonly badges: Map<string, HTMLElement> = new Map();
  private readonly badgeStates: Map<string, BadgeState> = new Map();
  /** Per-series progress, seeded from the model and driven by the wire. */
  private readonly seriesProgress: Map<string, ListingProgress> = new Map();
  /** Each study's progress mount and the series it sums over. */
  private readonly studyTracks: Map<string, { mount: HTMLElement; uids: string[] }> = new Map();
  private readonly traits: ReadonlyArray<ListingTrait<SeriesRow>>;
  private readonly actions: ReadonlyArray<ListingAction<SeriesRow>>;
  private readonly studyTraits: ReadonlyArray<ListingTrait<StudyRow>>;
  private readonly studyActions: ReadonlyArray<ListingAction<StudyRow>>;
  private readonly order: RosterOrder<SeriesRow>;
  private readonly studyOrder: RosterOrder<StudyRow>;
  private readonly host: ListingHost<StudyRow>;
  private readonly expansion: Expansion = { mode: STUDY_EXPANSION, open: new Set<string>() };
  private readonly filterPill: HTMLElement | null;
  private readonly stateSpan: HTMLElement | null;
  /** Says when an answer was answered, when it was not answered just now. */
  private readonly provenance: HTMLElement;
  /** QUERY, or RE-QUERY while a replayed answer is on stage. */
  private readonly run: HTMLElement;
  private model: PacsQueryModel | null = null;
  /** Whether the answer on stage came from a stored query. */
  private replayed: boolean = false;

  /**
   * @param root - The `#pacs-workspace` element.
   * @param handlers - Host callbacks.
   */
  constructor(root: HTMLElement, handlers: PacsPanelHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.command = element_input(root, '#pacs-command');
    this.results = element_query(root, '#pacs-results');
    this.gatherRows = element_query(root, '#pacs-gather-rows');
    this.gatherName = element_input(root, '#pacs-gather-name');
    this.traits = this.traits_declare();
    this.actions = this.actions_declare();
    this.studyTraits = this.studyTraits_declare();
    this.studyActions = this.studyActions_declare();
    // Two levels, two column declarations, one frame. The STUDY caps head
    // the region and are always on stage; a study's SERIES caps are minted
    // inside it and appear when it unfolds.
    this.studyOrder = new RosterOrder<StudyRow>(
      traitColumns_of(this.studyTraits),
      traitValue_of(this.studyTraits),
      (): void => this.results_repaint(),
      undefined,
      // The fold glyph is a cell of the grid, so the caps carry a blank
      // over it and every cap still sits above its column.
      1,
    );
    this.order = new RosterOrder<SeriesRow>(
      traitColumns_of(this.traits),
      traitValue_of(this.traits),
      (): void => this.results_repaint(),
      undefined,
      0,
      // The series caps are minted per study; this order's own frame is
      // never mounted, so it carries no caps and no strip of its own.
      false,
    );
    this.host = new ListingHost<StudyRow>(this.results, this.studyOrder);
    this.filterPill = root.querySelector<HTMLElement>('.pacs-filter');
    this.stateSpan = root.querySelector<HTMLElement>('.pane-state');
    this.filterPill?.addEventListener('click', (): void => this.studyOrder.strip_toggle());
    this.studyOrder.stripChange_observe((): void => this.filterPill_sync());
    // One filter, read at both levels: the strip belongs to the study
    // order, and the series order is told the same text so a study that
    // does not match itself can still keep the series that do.
    this.studyOrder.filterChange_observe((text: string): void => {
      this.order.filter_set(text, false);
    });
    this.filterPill_sync();
    // The frame is seated before the first query, so FILTER means something
    // the moment the pane is on stage rather than only after an answer.
    this.host.field_open();
    // The language reaches the same state the frame's block does.
    root.addEventListener('argus:roster', (event: Event): void => {
      const detail = (event as CustomEvent<
        { op: 'sort'; key: string; dir?: 'asc' | 'desc' } | { op: 'filter'; text: string }
      >).detail;
      // A column names its level: `pacs sort accession` orders studies,
      // `pacs sort modality` orders every study's series.
      if (detail.op === 'sort') {
        this.studyOrder.sort_set(detail.key, detail.dir ?? 'asc');
        this.order.sort_set(detail.key, detail.dir ?? 'asc');
      } else if (detail.text === '') {
        this.studyOrder.strip_toggle(false);
      } else {
        this.studyOrder.filter_set(detail.text);
      }
    });

    for (const { id } of FORM_TERMS) {
      const field: HTMLInputElement = element_input(root, `#${id}`);
      field.addEventListener('input', (): void => this.command_regenerate());
      // Enter in any term runs the query. Filling a field and pressing
      // return is what a form means; making the operator reach for the
      // button afterwards is a step the gesture already stated.
      field.addEventListener('keydown', (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.query_run();
        }
      });
    }
    this.provenance = element_query(root, '#pacs-provenance');
    this.run = element_query(root, '#pacs-run');
    // The control carries the intent; the line carries the command.
    this.run.addEventListener('click', (): void => this.query_run(this.replayed));
    this.command.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Enter') this.query_run();
    });
    element_query(root, '#pacs-gather-save').addEventListener('click', (): void => this.manifest_save());
    element_query(root, '#pacs-gather-feed').addEventListener('click', (): void => this.feed_create());
  }

  /**
   * The study listing's columns: the level above the series.
   *
   * ACCESSION earns a column of its own. It is the number a radiologist
   * quotes and a report is filed under, so it is the field an operator
   * arrives holding — a study's identity in the hospital, not a detail to
   * be read out of a run-on label.
   *
   * @returns The traits, in cap order.
   */
  private studyTraits_declare(): ReadonlyArray<ListingTrait<StudyRow>> {
    return [
      {
        key: 'patient',
        label: 'PATIENT',
        className: 'pacs-study-patient',
        cell: (row: StudyRow): string => row.study.patientName || '(unknown)',
      },
      {
        key: 'mrn',
        label: 'MRN',
        className: 'pacs-study-mrn',
        cell: (row: StudyRow): string => row.study.patientId || '—',
      },
      {
        key: 'study',
        label: 'STUDY',
        className: 'pacs-study-desc',
        cell: (row: StudyRow): string => row.study.description || '(no description)',
      },
      {
        key: 'date',
        label: 'DATE',
        className: 'pacs-study-date',
        cell: (row: StudyRow): string => row.study.date,
      },
      {
        key: 'accession',
        label: 'ACCESSION',
        className: 'pacs-study-accession',
        cell: (row: StudyRow): string => row.study.accession || '—',
      },
      {
        key: 'modality',
        label: 'MODALITY',
        className: 'pacs-study-modalities',
        cell: (row: StudyRow): string => row.study.modalities,
      },
      {
        key: 'series',
        label: 'SERIES',
        className: 'pacs-study-count',
        cell: (row: StudyRow): string => String(row.study.series.length),
        compare: (row: StudyRow): number => row.study.series.length,
      },
      {
        key: 'progress',
        label: 'PROGRESS',
        className: 'pacs-study-progress',
        // The study's bar is its series' summed. The mount is remembered so
        // a retrieve in flight moves it without a re-render.
        cell: (row: StudyRow): HTMLElement => {
          const holder: HTMLSpanElement = document.createElement('span');
          holder.className = 'pacs-study-progress';
          this.studyTracks.set(row.key, {
            mount: holder,
            uids: row.study.series.map((series: PacsSeries): string => series.seriesUID),
          });
          this.studyTrack_paint(row.key);
          return holder;
        },
        compare: (row: StudyRow): number => {
          const progress: ListingProgress = this.studyProgress_of(row);
          return progress.total === 0 ? -1 : progress.done / progress.total;
        },
      },
    ];
  }

  /** A study's verbs. Pulling a study queues every series it holds. */
  private studyActions_declare(): ReadonlyArray<ListingAction<StudyRow>> {
    return [
      {
        label: 'PULL STUDY',
        offered: (row: StudyRow): boolean => row.study.vfsPath !== undefined,
        run: (row: StudyRow): void => {
          const vfsPath: string | undefined = row.study.vfsPath;
          if (vfsPath === undefined) return;
          this.handlers.command_run(`pull ${vfsPath}`);
          for (const series of row.study.series) {
            if (series.vfsPath !== undefined && series.pulled !== true) {
              this.gather_note(row.study, series);
              this.badgeState_set(series.seriesUID, { status: 'queued' });
            }
          }
        },
      },
    ];
  }

  /** A study's progress: its series' summed, never averaged. */
  private studyProgress_of(row: StudyRow): ListingProgress {
    return progress_aggregate(
      row.study.series.map(
        (series: PacsSeries): ListingProgress =>
          this.seriesProgress.get(series.seriesUID) ?? { done: 0, total: 0 },
      ),
    );
  }

  /**
   * The series listing's columns, declared once for caps, cells and order.
   *
   * STATE holds a badge rather than text, because a retrieve in flight is a
   * picture and a fraction at once; it still sorts and filters, by the name
   * of what it is doing.
   *
   * @returns The traits, in cap order.
   */
  private traits_declare(): ReadonlyArray<ListingTrait<SeriesRow>> {
    return [
      {
        key: 'series',
        label: 'SERIES',
        className: 'pacs-series-desc',
        cell: (row: SeriesRow): string => row.series.description || '(no description)',
        compare: (row: SeriesRow): string => row.series.description,
      },
      {
        key: 'state',
        label: 'STATE',
        className: 'pacs-badge',
        cell: (row: SeriesRow): HTMLElement => this.badge_build(row.series),
        compare: (row: SeriesRow): string => this.state_name(row.series),
      },
      {
        key: 'modality',
        label: 'MODALITY',
        className: 'pacs-series-modality',
        cell: (row: SeriesRow): string => row.series.modality,
      },
      {
        key: 'files',
        label: 'FILES',
        className: 'pacs-series-files',
        cell: (row: SeriesRow): string =>
          row.series.fileCount !== undefined ? `${row.series.fileCount} FILES` : '',
        compare: (row: SeriesRow): number => row.series.fileCount ?? -1,
      },
    ];
  }

  /**
   * A series' verbs. A series already in CUBE is gathered, not pulled; one
   * that carries no UID is offered PULL and refused it, which says more
   * than hiding the capsule would.
   *
   * @returns The actions, in capsule order.
   */
  private actions_declare(): ReadonlyArray<ListingAction<SeriesRow>> {
    return [
      {
        label: 'GATHER',
        offered: (row: SeriesRow): boolean => row.series.pulled === true,
        run: (row: SeriesRow): void => this.gather_note(row.study, row.series),
      },
      {
        label: 'PULL',
        offered: (row: SeriesRow): boolean => row.series.pulled !== true,
        disabled: (row: SeriesRow): boolean => row.series.vfsPath === undefined,
        run: (row: SeriesRow): void => {
          const vfsPath: string | undefined = row.series.vfsPath;
          if (vfsPath === undefined) return;
          this.handlers.command_run(`pull ${vfsPath}`);
          this.badgeState_set(row.series.seriesUID, { status: 'queued' });
          this.gather_note(row.study, row.series);
        },
      },
    ];
  }

  /** The state a series is in, as a word: what STATE sorts and filters by. */
  private state_name(series: PacsSeries): string {
    if (series.pulled === true) return 'pulled';
    return this.badgeStates.get(series.seriesUID)?.status ?? 'idle';
  }

  /** Regenerates the editable command line from the form's filled terms. */
  private command_regenerate(): void {
    const terms: string[] = [];
    for (const { id, term } of FORM_TERMS) {
      const value: string = element_input(this.root, `#${id}`).value.trim();
      if (value.length > 0) terms.push(`${term}:${value}`);
    }
    this.command.value = terms.length > 0 ? `pacs query ${terms.join(',')}` : '';
  }

  /**
   * Runs the command line as edited.
   *
   * Only pressing RE-QUERY adds `--fresh`, and it is written into the
   * visible line before it runs. Enter on the command line runs the line
   * exactly as it reads — the pane's whole claim is that the line is what
   * runs, and silently appending a flag to it because the pane happens to
   * be showing a replay would make that claim false.
   *
   * @param fresh - True when the operator asked to bypass the stored answer.
   */
  private query_run(fresh: boolean = false): void {
    if (fresh && !FRESH_FLAG_PATTERN.test(this.command.value)) {
      this.command.value = `${this.command.value.trim()} ${FRESH_FLAG}`;
    }
    const line: string = this.command.value.trim();
    if (line.length === 0) return;
    this.model = null;
    this.host.field_open().appendChild(this.waiting_build());
    this.handlers.command_run(line);
  }

  /**
   * Says where the answer on stage came from, and what the control does next.
   *
   * A fresh answer has no pill: the absence is the statement. A replayed
   * one names the date — the fact worth quoting — and the elapsed time,
   * which is the judgement worth acting on, and the control becomes the
   * thing that would replace it.
   *
   * @param provenance - The model's provenance, when it carries one.
   */
  private provenance_show(provenance: PacsProvenance | undefined): void {
    this.replayed = provenance?.replayed === true;
    this.run.textContent = this.replayed ? 'RE-QUERY' : 'QUERY';
    this.run.classList.toggle('pacs-capsule-requery', this.replayed);
    this.provenance.hidden = !this.replayed;
    if (!this.replayed) {
      this.provenance.textContent = '';
      // The line and the control must agree: once the answer is fresh,
      // a further press means what QUERY means.
      this.command.value = this.command.value.replace(FRESH_FLAG_PATTERN, '').trimEnd();
      return;
    }
    const at: string = provenance?.answeredAt ?? '';
    const elapsed: string | null = elapsed_describe(at);
    const day: string = at.slice(0, 10);
    this.provenance.textContent = elapsed === null
      ? `RESULTS ${day}`
      : `RESULTS ${day} · ${elapsed}`;
    this.provenance.title = at;
  }

  /**
   * The waiting state for a query in flight.
   *
   * A PACS query can take many seconds, and a single line of text is easy
   * to mistake for a finished answer that happens to be empty. This says
   * the pane is working, and keeps saying it.
   *
   * @returns The element to stand in for results.
   */
  private waiting_build(): HTMLElement {
    const wait: HTMLElement = document.createElement('div');
    wait.className = 'pacs-waiting';
    const track: HTMLSpanElement = document.createElement('span');
    track.className = 'pacs-bar pacs-bar-pacing';
    const fill: HTMLSpanElement = document.createElement('span');
    fill.className = 'pacs-bar-fill';
    track.appendChild(fill);
    const said: HTMLSpanElement = document.createElement('span');
    said.className = 'pacs-waiting-note';
    said.textContent = 'QUERYING THE PACS…';
    wait.append(track, said);
    return wait;
  }

  /**
   * Observes envelopes; a `pacs.query` model repaints the results.
   *
   * @param envelope - Any envelope crossing the session.
   */
  public envelope_observe(envelope: WireEnvelope): void {
    if (envelope.model?.kind !== PACS_QUERY_MODEL_KIND) return;
    const parsed = pacsQueryModelSchema.safeParse(envelope.model.data);
    if (!parsed.success) return;
    this.results_render(parsed.data);
  }

  /**
   * Drives the per-series badges and the level progress from typed
   * retrieve progress.
   *
   * @param message - A progress message; pull messages carry the series UID.
   */
  public progress_observe(message: ProgressMessage): void {
    if (message.operation !== 'pull' || message.itemId === undefined) return;
    // Per-series messages stay in the 'watching' phase for their whole
    // life; the terminal states arrive in `status`, so that is the truth
    // the badge follows.
    const status: string = message.status ?? 'running';
    const state: BadgeState = { status };
    if (message.current !== undefined) state.current = message.current;
    if (message.total !== undefined) state.total = message.total;
    this.badgeState_set(message.itemId, state);
  }

  /**
   * Records what a series is doing, repaints its badge, and re-sums the
   * study it belongs to.
   *
   * The record is what survives a re-render: sorting the listing rebuilds
   * every badge, and a badge rebuilt from nothing would forget a retrieve
   * still in flight.
   *
   * @param seriesUID - The series.
   * @param state - What it is doing now.
   */
  private badgeState_set(seriesUID: string, state: BadgeState): void {
    this.badgeStates.set(seriesUID, state);
    this.seriesProgress.set(seriesUID, progress_ofState(state, this.seriesProgress.get(seriesUID)));
    const badge: HTMLElement | undefined = this.badges.get(seriesUID);
    if (badge) this.badge_paint(badge, state);
    for (const [key, track] of this.studyTracks) {
      if (track.uids.includes(seriesUID)) this.studyTrack_paint(key);
    }
  }

  /**
   * Builds a series' STATE cell.
   *
   * @param series - The series.
   * @returns The badge element, registered so the wire can repaint it.
   */
  private badge_build(series: PacsSeries): HTMLElement {
    const badge: HTMLSpanElement = document.createElement('span');
    badge.className = 'pacs-badge';
    if (series.pulled === true) {
      // Already home: a filled bar says so, and the action is gather, not pull.
      const bar: HTMLSpanElement = document.createElement('span');
      bar.className = 'pacs-bar-full';
      const note: HTMLSpanElement = document.createElement('span');
      note.className = 'pacs-badge-note';
      note.textContent = series.pulledFiles !== undefined
        ? `✓ ${series.pulledFiles} IN CUBE`
        : '✓ IN CUBE';
      badge.append(bar, note);
      badge.dataset['state'] = 'done';
      return badge;
    }
    this.badges.set(series.seriesUID, badge);
    // A series nothing has been asked of still gets a track, dimmed. An
    // empty cell reads as a column that does not apply here; a dim track
    // reads as nothing has happened yet, which is the truth.
    this.badge_paint(badge, this.badgeStates.get(series.seriesUID) ?? { status: 'idle' });
    return badge;
  }

  /**
   * Paints a badge from what its series is doing.
   *
   * @param badge - The badge element.
   * @param state - The series' state.
   */
  private badge_paint(badge: HTMLElement, state: BadgeState): void {
    badge.replaceChildren();
    badge.dataset['state'] = state.status;
    const note: HTMLSpanElement = document.createElement('span');
    note.className = 'pacs-badge-note';

    if (state.status === 'idle') {
      note.textContent = BADGE_TEXT['idle'] ?? 'NOT RETRIEVED';
      badge.append(progressCell_build({ done: 0, total: 0 }), note);
      return;
    }
    if (state.status !== 'running' && state.status !== 'queued') {
      badge.textContent = BADGE_TEXT[state.status] ?? state.status.toUpperCase();
      return;
    }
    // A running pull shows how far it has got, not just that it is going.
    // Without a total there is no fraction to draw, so the bar paces
    // instead — still motion, still honest about knowing no better.
    const counted: string = state.total !== undefined ? ` ${state.current ?? 0}/${state.total}` : '';
    const fraction: number | null =
      state.status === 'queued' || state.total === undefined || state.total === 0
        ? null
        : Math.min(1, (state.current ?? 0) / state.total);
    const track: HTMLSpanElement = document.createElement('span');
    track.className = fraction === null ? 'pacs-bar pacs-bar-pacing' : 'pacs-bar';
    const fill: HTMLSpanElement = document.createElement('span');
    fill.className = 'pacs-bar-fill';
    if (fraction !== null) fill.style.width = `${Math.round(fraction * 100)}%`;
    track.appendChild(fill);
    note.textContent = state.status === 'queued'
      ? (BADGE_TEXT['queued'] ?? 'QUEUED')
      : `${BADGE_TEXT['running']}${counted}`;
    badge.append(track, note);
  }

  /**
   * Takes a query's answer: seeds what is known, then paints.
   *
   * The same query's model can arrive more than once, and a repeat must not
   * undo what the operator has done since the first — a study they unfolded
   * stays unfolded, a retrieve in flight keeps its count. Only a NEW query
   * (a different id, or a query just sent) resets the pane.
   *
   * @param model - The decoded answer.
   */
  private results_render(model: PacsQueryModel): void {
    const sameQuery: boolean = this.model !== null && this.model.queryId === model.queryId;
    this.model = model;
    this.provenance_show(model.provenance);
    if (!sameQuery) {
      this.expansion.open.clear();
      this.badgeStates.clear();
      // One study opens itself; a crowd arrives folded.
      if (model.studies.length === 1) {
        this.expansion.open.add(study_key(model.studies[0] as PacsStudy, 0));
      }
    }
    for (const study of model.studies) {
      for (const series of study.series) {
        // What the wire has said outranks what the answer said: a retrieve
        // reported since the query would otherwise be erased by a repeat.
        if (sameQuery && this.badgeStates.has(series.seriesUID)) continue;
        this.seriesProgress.set(series.seriesUID, progress_ofSeries(series));
      }
    }
    this.results_repaint();
  }

  /**
   * Paints the listing: one frame, two levels, a group per study.
   *
   * The whole answer is counted as ONE listing so the state line reports
   * the series the operator is actually looking at, rather than whichever
   * study happened to be rendered last.
   *
   * The filter reads down the levels: a study that matches on its own
   * columns keeps all its series, a study that does not keeps the series
   * that match, and a study with neither leaves the stage — so filtering by
   * an accession gives a whole study, and by a modality gives the series.
   */
  private results_repaint(): void {
    const model: PacsQueryModel | null = this.model;
    const field: HTMLElement = this.host.field_open();
    this.badges.clear();
    this.studyTracks.clear();
    if (model === null) return;
    if (model.studies.length === 0) {
      field.appendChild(element_note('NO STUDIES FOUND'));
      this.state_sync();
      return;
    }

    const filtering: boolean = this.studyOrder.state_get().filter.length > 0;
    const studyRows: StudyRow[] = model.studies.map(
      (study: PacsStudy, index: number): StudyRow => ({ study, key: study_key(study, index) }),
    );
    let shown: number = 0;
    let total: number = 0;
    for (const row of this.studyOrder.sorted(studyRows)) {
      const seriesRows: SeriesRow[] = row.study.series.map(
        (series: PacsSeries): SeriesRow => ({ study: row.study, studyKey: row.key, series }),
      );
      total += seriesRows.length;
      const wholeStudy: boolean = !filtering || this.studyOrder.matches(row);
      const kept: SeriesRow[] = wholeStudy
        ? seriesRows
        : seriesRows.filter((entry: SeriesRow): boolean => this.order.matches(entry));
      if (kept.length === 0 && filtering) continue;
      shown += kept.length;
      field.appendChild(this.study_render(row, this.order.sorted(kept)));
    }
    this.studyOrder.counts_set(shown, total);
    this.state_sync();
  }

  /** Renders one study: its row on the study grid, then its series. */
  private study_render(row: StudyRow, rows: SeriesRow[]): HTMLElement {
    const open: boolean = expansion_isOpen(this.expansion, row.key);
    const block: HTMLElement = document.createElement('section');
    block.className = open ? 'pacs-study' : 'pacs-study pacs-collapsed';
    const head: HTMLElement = listingRow_build(row, this.studyTraits, {
      className: (): string => 'pacs-study-row',
      // The fold glyph is the row's own cell: it says what activation does,
      // and it sits in the grid so every cap keeps its column.
      leading: (entry: StudyRow): HTMLElement[] => {
        const fold: HTMLSpanElement = document.createElement('span');
        fold.className = 'pacs-fold';
        fold.textContent = expansion_isOpen(this.expansion, entry.key) ? '▾' : '▸';
        return [fold];
      },
      decorate: (element: HTMLElement, entry: StudyRow): void => {
        element.appendChild(actionCell_build(entry, this.studyActions));
        element.title = 'unfold this study\'s series (the study keeps its place)';
        element.addEventListener('click', (): void => {
          const nowOpen: boolean = expansion_toggle(this.expansion, entry.key);
          block.classList.toggle('pacs-collapsed', !nowOpen);
          const glyph: HTMLElement | null = element.querySelector('.pacs-fold');
          if (glyph !== null) glyph.textContent = nowOpen ? '▾' : '▸';
        });
      },
    });
    block.appendChild(head);
    // The series are a listing of their own, on their own grid: every study
    // heads them with caps minted from the one column declaration, so a
    // sort touched in any study lights and orders them all.
    const level: HTMLElement = document.createElement('div');
    level.className = 'pacs-series-level';
    level.appendChild(this.order.caps_mint());
    for (const entry of rows) {
      level.appendChild(listingRow_build(entry, this.traits, {
        className: (): string => 'pacs-series',
        decorate: (element: HTMLElement, series: SeriesRow): void => {
          element.appendChild(actionCell_build(series, this.actions));
        },
      }));
    }
    block.appendChild(level);
    return block;
  }

  /** Re-sums a study's progress from its series and repaints its track. */
  private studyTrack_paint(studyKey: string): void {
    const track: { mount: HTMLElement; uids: string[] } | undefined = this.studyTracks.get(studyKey);
    if (track === undefined) return;
    const parts: ListingProgress[] = track.uids.map(
      (uid: string): ListingProgress => this.seriesProgress.get(uid) ?? { done: 0, total: 0 },
    );
    track.mount.replaceChildren(progressCell_build(progress_aggregate(parts)));
  }

  /** Writes the listing's state onto the pane's bar, and lights the pill. */
  private state_sync(): void {
    if (this.stateSpan !== null) this.stateSpan.textContent = this.studyOrder.summary();
  }

  /** The FILTER pill reads the strip's state, like every mode block. */
  private filterPill_sync(): void {
    if (this.filterPill === null) return;
    const open: boolean = this.studyOrder.strip_isOpen();
    this.filterPill.textContent = open ? 'FILTER ON' : 'FILTER OFF';
    this.filterPill.classList.toggle('rail-off', !open);
    this.state_sync();
  }

  /** Shows or hides the results filter strip (the drawer's FILTER). */
  public filter_toggle(open?: boolean): void {
    this.studyOrder.strip_toggle(open);
  }

  /** Records one series into the gather without touching badges. */
  private gather_note(study: PacsStudy, series: PacsSeries): void {
    if (series.vfsPath === undefined) return;
    this.gather_add({
      seriesUID: series.seriesUID,
      description: series.description,
      modality: series.modality,
      patient: study.patientId || study.patientName,
      vfsPath: series.vfsPath,
      selected: true,
    });
  }

  /** Adds one series to the gather and repaints the tray. */
  private gather_add(entry: GatherEntry): void {
    this.gather.set(entry.seriesUID, entry);
    this.gather_render();
  }

  /** Paints the gather tray: the curated cohort. */
  private gather_render(): void {
    this.gatherRows.replaceChildren();
    for (const entry of this.gather.values()) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = 'pacs-gather-row';
      const check: HTMLInputElement = document.createElement('input');
      check.type = 'checkbox';
      check.checked = entry.selected;
      check.addEventListener('change', (): void => {
        entry.selected = check.checked;
      });
      const label: HTMLSpanElement = document.createElement('span');
      label.className = 'pacs-gather-label';
      label.textContent = `${entry.patient} · ${entry.description || entry.seriesUID} [${entry.modality}]`;
      row.append(check, label);
      this.gatherRows.appendChild(row);
    }
  }

  /** @returns The curated (still-selected) cohort. */
  private cohort_selected(): GatherEntry[] {
    return [...this.gather.values()].filter((entry: GatherEntry): boolean => entry.selected);
  }

  /** Writes the cohort manifest to `~/gather/<name>`. */
  private manifest_save(): void {
    const cohort: GatherEntry[] = this.cohort_selected();
    const name: string = this.gatherName.value.trim() || `gather-${Date.now()}`;
    if (cohort.length === 0) return;
    const manifest: string = JSON.stringify({
      name,
      gatheredAt: new Date().toISOString(),
      series: cohort.map((entry: GatherEntry) => ({
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
   * Roots a new feed on the cohort: one visible, auditable command. Pull is
   * idempotent, so already-retrieved series confirm rather than re-fetch.
   */
  private feed_create(): void {
    const cohort: GatherEntry[] = this.cohort_selected();
    const name: string = this.gatherName.value.trim() || `gather-${Date.now()}`;
    if (cohort.length === 0) return;
    const paths: string = cohort.map((entry: GatherEntry): string => entry.vfsPath).join(' ');
    this.handlers.command_show(`pull --new-feed "${name}" ${paths}`);
  }
}

/** A study's key: its UID, or its place when the PACS sent none. */
function study_key(study: PacsStudy, index: number): string {
  return study.studyUID ?? `study-${index}`;
}

/** What a series' progress is before anything has been asked of it. */
function progress_ofSeries(series: PacsSeries): ListingProgress {
  const held: number = series.pulledFiles ?? 0;
  const total: number = Math.max(series.fileCount ?? 0, held);
  if (series.pulled === true) return { done: total, total };
  return { done: held, total };
}

/**
 * What a wire state says about progress.
 *
 * A terminal state settles the bar at whatever total was known: a finished
 * retrieve that never reported a count still reads as finished, not as
 * nothing scheduled.
 *
 * @param state - The badge state just recorded.
 * @param known - What was known before, whose total stands when the wire
 *   sends none.
 * @returns The series' progress.
 */
function progress_ofState(state: BadgeState, known: ListingProgress | undefined): ListingProgress {
  const total: number = state.total ?? known?.total ?? 0;
  if (state.status === 'error') return { done: state.current ?? known?.done ?? 0, total, failed: true };
  if (state.status === 'done') return { done: total, total };
  return { done: state.current ?? known?.done ?? 0, total };
}

/** Fetches a required element within the workspace. */
function element_query(root: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = root.querySelector(selector);
  if (found === null) throw new Error(`PACS workspace is missing '${selector}'`);
  return found;
}

/** Fetches a required input within the workspace. */
function element_input(root: HTMLElement, selector: string): HTMLInputElement {
  const found: HTMLElement = element_query(root, selector);
  if (!(found instanceof HTMLInputElement)) throw new Error(`'${selector}' is not an input`);
  return found;
}

/** A small dim note element. */
function element_note(text: string): HTMLElement {
  const note: HTMLParagraphElement = document.createElement('p');
  note.className = 'files-empty';
  note.textContent = text;
  return note;
}
