/**
 * @file The NOTES pane: what the installed releases changed, as a listing.
 *
 * The kernel's `notes` answers a `session.notes` model — releases, each the
 * packages one Version Packages merge published, each change a headline
 * and the rest; this pane is its projection on the stage: one block per
 * release under the listing façade's caps, one row per headline, and a
 * press on a headline that has more unfolds the rest beneath it. The pane
 * writes nothing of its own: the rows are the kernel's, the pane names the
 * release it reads (a-readout-names-the-release-it-reads) on its bar.
 *
 * @module
 */
import type { SessionNotes, NotesRelease, NotesChange } from '@fnndsc/menu';
import { Listing } from '../roster/listing.js';
import type { ListingTrait } from '../roster/row.js';
import type { ListingBlock } from '../roster/listing.js';

/** One row: a change's headline, or the unfolded rest beneath it. */
export interface NotesRow {
  /** Row identity: `<merge|date>:<package>:<index>` and `:body` for the unfolded rest. */
  key: string;
  /** The package tag (`argus`); empty on a body row. */
  tag: string;
  /** The headline, or the body text. */
  text: string;
  /** Whether the row is the rest of a change (indented, quiet). */
  body: boolean;
  /** Whether a headline has a rest to unfold. */
  more: boolean;
  /** The change is ours alone (written "Internal:"). */
  internal: boolean;
  /** The key of the headline this row belongs to. */
  of: string;
}

/** What `notes` wants asked again: how many releases, whether internal rows too. */
export interface NotesAskAgain {
  since: number | 'all';
  all: boolean;
}

/** The pane's hooks: a line to the session, quietly. */
export interface NotesPanelHooks {
  /** Re-asks the kernel (`notes --since N [--all]`) and answers its model, or null. */
  ask: (line: string) => Promise<SessionNotes | null>;
}

/** The release title the kernel also prints: the day and every package that moved. */
export function release_title(release: NotesRelease): string {
  return `${release.date ?? 'undated'} · ${release.entries.map((e): string => `${e.package} ${e.version}`).join(' · ')}`;
}

/**
 * The rows a model makes, with the unfolded changes' bodies beneath their headlines.
 *
 * @param model - The kernel's answer.
 * @param unfolded - The headline keys whose rest is shown.
 * @returns One block per release, in the model's order.
 */
export function notesBlocks_build(model: SessionNotes, unfolded: ReadonlySet<string>): Array<{ key: string; title: string; rows: NotesRow[] }> {
  return model.releases.map((release: NotesRelease) => {
    const id: string = release.merge ?? release.date ?? 'undated';
    const rows: NotesRow[] = [];
    for (const entry of release.entries) {
      entry.changes.forEach((change: NotesChange, index: number): void => {
        const key: string = `${id}:${entry.package}:${index}`;
        const more: boolean = change.body !== '';
        rows.push({ key, tag: entry.package, text: change.headline, body: false, more, internal: change.internal, of: key });
        if (more && unfolded.has(key)) rows.push({ key: `${key}:body`, tag: '', text: change.body, body: true, more: false, internal: change.internal, of: key });
      });
    }
    return { key: id, title: release_title(release), rows };
  });
}

/** The NOTES pane: the releases as a listing. */
export class NotesPanel {
  private readonly listing: Listing<NotesRow>;
  private readonly state: HTMLElement | null;
  private readonly sincePill: HTMLElement | null;
  private readonly internalPill: HTMLElement | null;
  private model: SessionNotes | null = null;
  private readonly unfolded: Set<string> = new Set();
  private ask: NotesAskAgain = { since: 1, all: false };

  /**
   * @param mount - The stamped pane element (`tpl-pane-notes`).
   * @param hooks - The session line.
   */
  constructor(mount: HTMLElement, private readonly hooks: NotesPanelHooks) {
    const panel: HTMLElement | null = mount.querySelector<HTMLElement>('.notes-panel');
    if (panel === null) throw new Error('notes pane: no .notes-panel in its template');
    this.state = mount.querySelector<HTMLElement>('.pane-state');
    this.sincePill = mount.querySelector<HTMLElement>('.notes-since');
    this.internalPill = mount.querySelector<HTMLElement>('.notes-internal');
    this.listing = new Listing<NotesRow>({
      mount: panel,
      traits: this.traits_declare(),
      key: (row: NotesRow): string => row.key,
      chrome: { root: mount, prefix: 'notes' },
      caps: 'root',
      // A headline with more unfolds on a press; a body row and a bare headline are readouts.
      activatable: (row: NotesRow): boolean => row.more,
      activate: (row: NotesRow): void => this.unfold_toggle(row.of),
      row: { className: (row: NotesRow): string => `notes-row${row.body ? ' notes-row-body' : ''}${row.internal ? ' notes-row-internal' : ''}${row.more ? ' notes-row-more' : ''}` },
    });
    this.sincePill?.addEventListener('click', (): void => { void this.since_cycle(); });
    this.internalPill?.addEventListener('click', (): void => { void this.internal_toggle(); });
    this.pills_paint();
  }

  /** The two columns: the package, and the words (which take the expanse). */
  private traits_declare(): ReadonlyArray<ListingTrait<NotesRow>> {
    return [
      { key: 'tag', label: 'PACKAGE', className: 'notes-tag', width: 'minmax(5em, 7em)', cell: (row: NotesRow): string => row.tag },
      { key: 'text', label: 'CHANGE', className: 'notes-text', width: 'minmax(16em, 1fr)', cell: (row: NotesRow): string => (row.more && !row.body ? `${row.text} ▸` : row.text) },
    ];
  }

  /** Shows a model the kernel answered. */
  public model_show(model: SessionNotes): void {
    this.model = model;
    this.ask = { since: model.releases.length > 1 ? (model.releases.length >= model.total ? 'all' : model.releases.length) : 1, all: model.all };
    this.render();
  }

  /** The releases on the pane, in the model's order. */
  public releases_shown(): number {
    return this.model?.releases.length ?? 0;
  }

  /** Whether a headline's rest is shown. */
  public unfolded_is(key: string): boolean {
    return this.unfolded.has(key);
  }

  private unfold_toggle(key: string): void {
    if (this.unfolded.has(key)) this.unfolded.delete(key); else this.unfolded.add(key);
    this.render();
  }

  /** RECENT cycles 1 → 5 → ALL → 1, asking the kernel each time. */
  private async since_cycle(): Promise<void> {
    const next: NotesAskAgain['since'] = this.ask.since === 1 ? 5 : this.ask.since === 5 ? 'all' : 1;
    await this.ask_again({ ...this.ask, since: next });
  }

  private async internal_toggle(): Promise<void> {
    await this.ask_again({ ...this.ask, all: !this.ask.all });
  }

  private async ask_again(ask: NotesAskAgain): Promise<void> {
    const since: string = ask.since === 'all' ? '9999' : String(ask.since);
    const model: SessionNotes | null = await this.hooks.ask(`notes --since ${since}${ask.all ? ' --all' : ''}`);
    if (model === null) return;
    this.ask = ask;
    this.model_show(model);
  }

  private pills_paint(): void {
    if (this.sincePill !== null) this.sincePill.textContent = this.ask.since === 'all' ? 'ALL RELEASES' : this.ask.since === 1 ? 'LATEST RELEASE' : `LAST ${this.ask.since} RELEASES`;
    if (this.internalPill !== null) {
      this.internalPill.textContent = this.ask.all ? 'INTERNAL ON' : 'INTERNAL OFF';
      this.internalPill.classList.toggle('rail-off', !this.ask.all);
    }
  }

  private render(): void {
    const model: SessionNotes | null = this.model;
    if (model === null) return;
    const head = (text: string): HTMLElement => {
      const header: HTMLElement = document.createElement('header');
      header.className = 'files-path notes-block-head';
      header.textContent = text;
      return header;
    };
    const blocks: Array<ListingBlock<NotesRow>> = notesBlocks_build(model, this.unfolded).map((block) => ({ key: block.key, header: head(block.title), rows: block.rows }));
    this.listing.rows_set(blocks, { field: 'notes' });
    // The bar names the release read: the daemon's installed versions.
    if (this.state !== null) {
      const installed: string = Object.entries(model.installed).map(([name, version]): string => `${name} ${version}`).join(' · ');
      this.state.textContent = `${model.source.toUpperCase()} · ${installed}`;
    }
    this.pills_paint();
  }
}
