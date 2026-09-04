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
 * @module
 */
import {
  pacsQueryModelSchema,
  PACS_QUERY_MODEL_KIND,
  type PacsQueryModel,
  type PacsSeries,
  type PacsStudy,
  type WireEnvelope,
} from '@fnndsc/menu';
import type { ProgressMessage } from '../../calypso/client.js';

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

/** The form fields and the query terms they lower to. */
const FORM_TERMS: ReadonlyArray<{ id: string; term: string }> = [
  { id: 'pacs-f-mrn', term: 'PatientID' },
  { id: 'pacs-f-name', term: 'PatientName' },
  { id: 'pacs-f-date', term: 'StudyDate' },
  { id: 'pacs-f-modality', term: 'Modality' },
  { id: 'pacs-f-accession', term: 'AccessionNumber' },
];

/** Progress statuses worth a badge, mapped to badge text. */
const BADGE_TEXT: Readonly<Record<string, string>> = {
  running: 'RETRIEVING',
  done: '✓ PULLED',
  error: '✗ ERROR',
  unconfirmed: '? UNCONFIRMED',
  stalled: 'STALLED',
};

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
    element_query(root, '#pacs-run').addEventListener('click', (): void => this.query_run());
    this.command.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Enter') this.query_run();
    });
    element_query(root, '#pacs-gather-save').addEventListener('click', (): void => this.manifest_save());
    element_query(root, '#pacs-gather-feed').addEventListener('click', (): void => this.feed_create());

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

  /** Runs the command line as edited. */
  private query_run(): void {
    const line: string = this.command.value.trim();
    if (line.length === 0) return;
    this.results.replaceChildren(this.waiting_build());
    this.handlers.command_run(line);
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
   * Drives the per-series badges from typed retrieve progress.
   *
   * @param message - A progress message; pull messages carry the series UID.
   */
  public progress_observe(message: ProgressMessage): void {
    if (message.operation !== 'pull' || message.itemId === undefined) return;
    const badge: HTMLElement | undefined = this.badges.get(message.itemId);
    if (!badge) return;
    // Per-series messages stay in the 'watching' phase for their whole
    // life; the terminal states arrive in `status`, so that is the truth
    // the badge follows.
    const status: string = message.status ?? 'running';
    if (status !== 'running') {
      badge.textContent = BADGE_TEXT[status] ?? status.toUpperCase();
      badge.dataset['state'] = status;
      return;
    }
    // A running pull shows how far it has got, not just that it is going.
    // Without a total there is no fraction to draw, so the bar paces
    // instead — still motion, still honest about knowing no better.
    const counted: string =
      message.total !== undefined ? ` ${message.current ?? 0}/${message.total}` : '';
    const fraction: number | null =
      message.total !== undefined && message.total > 0
        ? Math.min(1, (message.current ?? 0) / message.total)
        : null;
    badge.replaceChildren();
    const track: HTMLSpanElement = document.createElement('span');
    track.className = fraction === null ? 'pacs-bar pacs-bar-pacing' : 'pacs-bar';
    const fill: HTMLSpanElement = document.createElement('span');
    fill.className = 'pacs-bar-fill';
    if (fraction !== null) fill.style.width = `${Math.round(fraction * 100)}%`;
    track.appendChild(fill);
    const note: HTMLSpanElement = document.createElement('span');
    note.className = 'pacs-badge-note';
    note.textContent = `${BADGE_TEXT['running']}${counted}`;
    badge.append(track, note);
    badge.dataset['state'] = 'running';
  }

  /** Renders one query's studies and series with PULL capsules. */
  private results_render(model: PacsQueryModel): void {
    this.results.replaceChildren();
    if (model.studies.length === 0) {
      this.results.appendChild(element_note('NO STUDIES FOUND'));
      return;
    }
    // One study opens itself; a crowd arrives folded.
    const collapsed: boolean = model.studies.length > 1;
    for (const study of model.studies) {
      this.results.appendChild(this.study_render(study, collapsed));
    }
  }

  /** Renders one study block: a toggling head, a study-level pull, series. */
  private study_render(study: PacsStudy, collapsed: boolean): HTMLElement {
    const block: HTMLElement = document.createElement('section');
    block.className = collapsed ? 'pacs-study pacs-collapsed' : 'pacs-study';
    const head: HTMLDivElement = document.createElement('div');
    head.className = 'pacs-study-head';
    const fold: HTMLSpanElement = document.createElement('span');
    fold.className = 'pacs-fold';
    fold.textContent = collapsed ? '▸' : '▾';
    const label: HTMLSpanElement = document.createElement('span');
    label.className = 'pacs-study-label';
    label.textContent =
      `${study.patientName || '(unknown)'} · MRN ${study.patientId || '—'} · ` +
      `${study.description || '(no description)'} · ${study.date} · ${study.series.length} SERIES`;
    head.append(fold, label);
    if (study.vfsPath !== undefined) {
      const vfsPath: string = study.vfsPath;
      const pullAll: HTMLButtonElement = document.createElement('button');
      pullAll.className = 'pacs-capsule pacs-capsule-study';
      pullAll.textContent = 'PULL STUDY';
      pullAll.addEventListener('click', (event: MouseEvent): void => {
        event.stopPropagation();
        this.handlers.command_run(`pull ${vfsPath}`);
        for (const series of study.series) {
          if (series.vfsPath !== undefined && series.pulled !== true) {
            this.gather_note(study, series);
            const badge: HTMLElement | undefined = this.badges.get(series.seriesUID);
            if (badge) {
              badge.textContent = 'QUEUED';
              badge.dataset['state'] = 'running';
            }
          }
        }
      });
      head.appendChild(pullAll);
    }
    head.addEventListener('click', (): void => {
      const nowCollapsed: boolean = block.classList.toggle('pacs-collapsed');
      fold.textContent = nowCollapsed ? '▸' : '▾';
    });
    block.appendChild(head);
    block.appendChild(this.caps_build());
    for (const series of study.series) {
      block.appendChild(this.series_render(study, series));
    }
    return block;
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

  /**
   * The column caps over a study's series.
   *
   * A study is a listing like any other, so it wears the same frame the
   * file browser and the runs roster wear: a bar of caps naming the
   * columns, in the same idiom and the same hues.
   *
   * @returns The caps row.
   */
  private caps_build(): HTMLElement {
    const caps: HTMLElement = document.createElement('div');
    caps.className = 'roster-caps pacs-series-caps';
    // The progress track and the action carry no cap: one is a picture,
    // the other a verb.
    const columns: ReadonlyArray<{ key: string; label: string }> = [
      { key: 'series', label: 'SERIES' },
      { key: 'state', label: 'STATE' },
      { key: 'modality', label: 'MODALITY' },
      { key: 'files', label: 'FILES' },
      { key: 'action', label: '' },
    ];
    for (const column of columns) {
      const cap: HTMLSpanElement = document.createElement('span');
      cap.className = 'roster-cap';
      cap.dataset['key'] = column.key;
      cap.textContent = column.label;
      caps.appendChild(cap);
    }
    return caps;
  }

  /** Renders one series row: facts, badge, and the PULL capsule. */
  private series_render(study: PacsStudy, series: PacsSeries): HTMLElement {
    const row: HTMLDivElement = document.createElement('div');
    row.className = 'pacs-series';
    const desc: HTMLSpanElement = document.createElement('span');
    desc.className = 'pacs-series-desc';
    desc.textContent = series.description || '(no description)';
    const modality: HTMLSpanElement = document.createElement('span');
    modality.className = 'pacs-series-modality';
    modality.textContent = series.modality;
    const files: HTMLSpanElement = document.createElement('span');
    files.className = 'pacs-series-files';
    files.textContent = series.fileCount !== undefined ? `${series.fileCount} FILES` : '';
    const badge: HTMLSpanElement = document.createElement('span');
    badge.className = 'pacs-badge';
    if (series.pulled === true) {
      // Already home: a filled bar says so, and the action is gather, not pull.
      const bar: HTMLSpanElement = document.createElement('span');
      bar.className = 'pacs-bar-full';
      badge.appendChild(bar);
      const note: HTMLSpanElement = document.createElement('span');
      note.className = 'pacs-badge-note';
      note.textContent = series.pulledFiles !== undefined
        ? `✓ ${series.pulledFiles} IN CUBE`
        : '✓ IN CUBE';
      badge.appendChild(note);
      badge.dataset['state'] = 'done';
      const gatherButton: HTMLButtonElement = document.createElement('button');
      gatherButton.className = 'pacs-capsule';
      gatherButton.textContent = 'GATHER';
      gatherButton.addEventListener('click', (): void => this.gather_note(study, series));
      row.append(desc, badge, modality, files, gatherButton);
      return row;
    }
    this.badges.set(series.seriesUID, badge);
    const pull: HTMLButtonElement = document.createElement('button');
    pull.className = 'pacs-capsule';
    pull.textContent = 'PULL';
    if (series.vfsPath === undefined) {
      pull.disabled = true;
      pull.title = 'series carried no UID — pull from the console';
    } else {
      const vfsPath: string = series.vfsPath;
      pull.addEventListener('click', (): void => {
        this.handlers.command_run(`pull ${vfsPath}`);
        badge.textContent = 'QUEUED';
        badge.dataset['state'] = 'running';
        this.gather_note(study, series);
      });
    }
    row.append(desc, badge, modality, files, pull);
    return row;
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
