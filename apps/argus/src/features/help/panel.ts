/**
 * @file The HELP pane: the keys and the verbs, as a listing.
 *
 * One table of chords (`DRAWER_CHORDS`) and one table of verbs (`VERB_LINES`)
 * live in the console language; this pane is their projection on the
 * stage — rows under caps, filterable, foldable into N MORE like every
 * listing — so a newcomer reads them where the panes are, and nothing here
 * is written by hand twice (aegis.adoc: keys-are-documented-from-one-table).
 *
 * @module
 */
import { Listing } from '../roster/listing.js';
import type { ListingTrait } from '../roster/row.js';
import { DRAWER_CHORDS, VERB_LINES, type DrawerChord } from '../../console/argusLang.js';

/** One row: a key or a verb, and what it does. */
export interface HelpRow {
  /** Row identity. */
  key: string;
  /** The key, or the verb's subject. */
  name: string;
  /** What it does. */
  does: string;
  /** The group the row belongs to, for its class. */
  topic: string;
}

/** The HELP pane: a listing of the chords and the verbs. */
export class HelpPanel {
  private readonly listing: Listing<HelpRow>;

  /**
   * @param mount - The stamped pane element (`tpl-pane-help`).
   */
  constructor(mount: HTMLElement) {
    const panel: HTMLElement | null = mount.querySelector<HTMLElement>('.help-panel');
    if (panel === null) throw new Error('help pane: no .help-panel in its template');
    this.listing = new Listing<HelpRow>({
      mount: panel,
      traits: this.traits_declare(),
      key: (row: HelpRow): string => row.key,
      chrome: { root: mount, prefix: 'help' },
      caps: 'root',
      activatable: (): boolean => false,
      row: { className: (row: HelpRow): string => `help-row help-${row.topic}` },
    });
    this.render();
  }

  /** The two columns: what you press or type, and what it does. */
  private traits_declare(): ReadonlyArray<ListingTrait<HelpRow>> {
    return [
      { key: 'name', label: 'KEY · VERB', className: 'help-key', width: 'minmax(9em, 12em)', cell: (row: HelpRow): string => row.name },
      { key: 'does', label: 'DOES', className: 'help-does', width: 'minmax(16em, 1fr)', cell: (row: HelpRow): string => row.does },
    ];
  }

  /** Paints both tables as two blocks, each led by a line saying how to use it. */
  private render(): void {
    const head = (text: string): HTMLElement => {
      const header: HTMLElement = document.createElement('header');
      header.className = 'files-path help-block-head';
      header.textContent = text;
      return header;
    };
    const chords: HelpRow[] = DRAWER_CHORDS.map((chord: DrawerChord): HelpRow => ({
      key: `k:${chord.key}`,
      name: chord.key,
      does: chord.does,
      topic: chord.topic,
    }));
    const verbs: HelpRow[] = VERB_LINES.map((line: string, index: number): HelpRow => {
      const space: number = line.indexOf(' ');
      return {
        key: `v:${index}`,
        name: space < 0 ? line : line.slice(0, space),
        does: space < 0 ? '' : line.slice(space + 1).trim(),
        topic: 'verb',
      };
    });
    this.listing.rows_set([
      { key: 'keys', header: head('KEYS — Ctrl-B opens the focused pane\'s drawer; then one key presses one of its verbs'), rows: chords },
      { key: 'verbs', header: head('VERBS — the console language; the long form is docs/argus-lang.adoc'), rows: verbs },
    ], { field: 'help' });
  }
}
