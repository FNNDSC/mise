/**
 * @jest-environment jsdom
 */
/**
 * @file Unit tests for the listing façade.
 *
 * These prove the façade's own claims against a real DOM (jsdom): that
 * every row holds exactly as many cells as the grid has tracks, `..` rows
 * and action tracks included — the defect that shipped, which no test
 * caught — and that the two laws the façade expresses hold as
 * consequences of the declaration. Layout and computed geometry are not
 * jsdom's to answer; those stay with the smoke suite.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  Listing,
  listingChild_declare,
  listingState_compose,
  listingTemplate_of,
  type ListingBlock,
  type ListingDeclaration,
  type ListingStateParts,
} from '../../src/features/roster/listing.js';
import type { ListingTrait } from '../../src/features/roster/row.js';

/** One fake entry: enough shape for a glyph, a name and a sortable size. */
interface Entry {
  name: string;
  kind: 'dir' | 'file';
  size: number;
}

/** A fake study with series beneath it, for the two-level case. */
interface Study {
  uid: string;
  description: string;
  series: Series[];
}

interface Series {
  uid: string;
  modality: string;
}

const ENTRY_TRAITS: ReadonlyArray<ListingTrait<Entry>> = [
  {
    key: 'glyph',
    label: '',
    className: 'glyph',
    capped: false,
    width: '1.4em',
    cell: (entry: Entry): string => (entry.kind === 'dir' ? '▸' : '·'),
  },
  {
    key: 'name',
    label: 'NAME',
    className: 'name',
    width: '1fr',
    cell: (entry: Entry): string => entry.name,
  },
  {
    key: 'size',
    label: 'SIZE',
    className: 'size',
    width: '6em',
    // Displayed short, ordered by the number: the case `compare` exists for.
    cell: (entry: Entry): string => `${entry.size}B`,
    compare: (entry: Entry): number => entry.size,
  },
];

const ENTRIES: Entry[] = [
  { name: 'beta', kind: 'file', size: 100 },
  { name: 'alpha', kind: 'dir', size: 0 },
  { name: 'gamma', kind: 'file', size: 20 },
];

const UP: Entry = { name: '..', kind: 'dir', size: 0 };

/** Waits for the frame RosterOrder and the façade coalesce their repaints into. */
async function frame(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    window.requestAnimationFrame((): void => {
      window.requestAnimationFrame((): void => resolve());
    });
  });
}

/** A pane root carrying the chrome convention under one prefix. */
function chrome_build(prefix: string): { root: HTMLElement; mount: HTMLElement } {
  const root: HTMLElement = document.createElement('div');
  root.innerHTML = `
    <span class="pane-state"></span>
    <button class="${prefix}-filter">FILTER OFF</button>
    <button class="${prefix}-select">SELECT OFF</button>
    <span class="${prefix}-selection-bar" hidden></span>
    <div class="mount"></div>
  `;
  document.body.appendChild(root);
  const mount: HTMLElement = root.querySelector<HTMLElement>('.mount') as HTMLElement;
  return { root, mount };
}

/** The tracks a template declares. */
function tracks_count(template: string): number {
  return template.trim().split(/\s+/).length;
}

/** The rows on stage, lead rows included. */
function rows_onStage(mount: HTMLElement): HTMLElement[] {
  return [...mount.querySelectorAll<HTMLElement>('.listing-row')];
}

/** The text of a row's name cell. */
function names_onStage(mount: HTMLElement): string[] {
  return rows_onStage(mount).map((row: HTMLElement): string => row.querySelector('.name')?.textContent ?? '');
}

function listing_build(
  overrides: Partial<ListingDeclaration<Entry>> = {},
  prefix: string = 'files',
): { listing: Listing<Entry>; root: HTMLElement; mount: HTMLElement } {
  const { root, mount } = chrome_build(prefix);
  const listing: Listing<Entry> = new Listing<Entry>({
    mount,
    traits: ENTRY_TRAITS,
    key: (entry: Entry): string => entry.name,
    chrome: { root, prefix },
    defaultSort: { key: 'name', dir: 'asc' },
    ...overrides,
  });
  return { listing, root, mount };
}

describe('listingTemplate_of', () => {
  it('lists every trait track, then the action track', () => {
    expect(listingTemplate_of(ENTRY_TRAITS, { width: '21em', of: (): [] => [] })).toBe('1.4em 1fr 6em 21em');
    expect(listingTemplate_of(ENTRY_TRAITS)).toBe('1.4em 1fr 6em');
  });

  it('refuses a trait without a width', () => {
    const traits: ReadonlyArray<ListingTrait<Entry>> = [{ key: 'x', label: 'X', className: 'x', cell: (): string => '' }];
    expect((): string => listingTemplate_of(traits)).toThrow(/declares no width/);
  });

  it('refuses a content-sized track, and accepts a fixed one, a share, or a minmax with a fixed minimum', () => {
    const named = (width: string): ReadonlyArray<ListingTrait<Entry>> =>
      [{ key: 'w', label: 'W', className: 'w', width, cell: (): string => '' }];
    for (const bad of ['auto', 'min-content', 'max-content', 'fit-content(10em)', 'minmax(0, 13em)', 'minmax(0px, 1fr)']) {
      expect((): string => listingTemplate_of(named(bad))).toThrow(/content-sized/);
    }
    for (const good of ['13em', '1fr', '7.5em', 'minmax(5em, 1fr)', 'minmax(4em, 12em)', '120px', '0.5fr']) {
      expect(listingTemplate_of(named(good))).toBe(good);
    }
    expect((): string => listingTemplate_of(ENTRY_TRAITS, { width: 'auto', of: (): [] => [] })).toThrow(/content-sized/);
  });

  it('refuses an uncapped trait that does not lead', () => {
    const traits: ReadonlyArray<ListingTrait<Entry>> = [
      { key: 'a', label: 'A', className: 'a', width: '1fr', cell: (): string => '' },
      { key: 'b', label: '', className: 'b', width: '1em', capped: false, cell: (): string => '' },
    ];
    expect((): string => listingTemplate_of(traits)).toThrow(/must lead/);
  });
});

describe('the grid is one declaration', () => {
  it('writes the template on the grid host and every row fills every track, lead rows and action track included', () => {
    const { listing, mount } = listing_build({ actions: { width: '21em', of: (): [] => [] } });
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    const template: string = mount.style.getPropertyValue('--roster-cols');
    expect(template).toBe('1.4em 1fr 6em 21em');
    const rows: HTMLElement[] = rows_onStage(mount);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.children).toHaveLength(tracks_count(template));
    expect(rows[0]?.querySelector('.name')?.textContent).toBe('..');
  });

  it('blanks exactly the leading uncapped columns in the caps row', () => {
    const { listing, mount } = listing_build();
    listing.rows_set([{ key: '/x', rows: ENTRIES }], { field: '/x' });
    const caps: HTMLElement | null = mount.querySelector<HTMLElement>('.roster-caps');
    expect(caps).not.toBeNull();
    const cells: Element[] = [...(caps as HTMLElement).children];
    expect(cells).toHaveLength(3);
    expect(cells[0]?.classList.contains('roster-cap')).toBe(false);
    expect(cells[1]?.classList.contains('roster-cap')).toBe(true);
    expect(cells[2]?.classList.contains('roster-cap')).toBe(true);
  });

  it('lets a form stand on the template through gridHost', () => {
    const { root, mount } = chrome_build('pacs');
    const listing: Listing<Entry> = new Listing<Entry>({
      mount,
      gridHost: root,
      traits: ENTRY_TRAITS,
      key: (entry: Entry): string => entry.name,
    });
    expect(root.style.getPropertyValue('--roster-cols')).toBe(listing.template_get());
    expect(mount.style.getPropertyValue('--roster-cols')).toBe('');
  });
});

describe('a-row-is-indicated-before-it-is-acted-on', () => {
  it('with no actions declared there is no track and a click activates', () => {
    const activate = jest.fn();
    const { listing, mount } = listing_build({ activate });
    listing.rows_set([{ key: '/x', rows: ENTRIES }], { field: '/x' });
    expect(mount.querySelector('.listing-actions')).toBeNull();
    expect(tracks_count(listing.template_get())).toBe(3);
    const row: HTMLElement = rows_onStage(mount)[0] as HTMLElement;
    row.click();
    expect(activate).toHaveBeenCalledWith(ENTRIES[1]);
    expect(listing.indicated_get()).toBeNull();
  });

  it('with actions declared a click indicates, a double-click activates, and no row changes shape', () => {
    const activate = jest.fn();
    const indicated = jest.fn();
    const run = jest.fn();
    const { listing, mount } = listing_build({
      activate,
      indicated,
      actions: { width: '21em', of: (): ReadonlyArray<{ label: string; run: (entry: Entry) => void }> => [{ label: 'OPEN', run }] },
    });
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    const before: number[] = rows_onStage(mount).map((row: HTMLElement): number => row.children.length);
    const row: HTMLElement = rows_onStage(mount)[1] as HTMLElement;
    row.click();
    expect(activate).not.toHaveBeenCalled();
    expect(indicated).toHaveBeenCalledWith(ENTRIES[1]);
    expect(listing.indicated_get()).toBe('alpha');
    expect(row.classList.contains('listing-indicated')).toBe(true);
    expect(row.querySelector('.listing-action')?.textContent).toBe('OPEN');
    // The verbs filled the track; nothing gained or lost a cell.
    expect(rows_onStage(mount).map((r: HTMLElement): number => r.children.length)).toEqual(before);
    // The verb runs on its row and does not activate it.
    (row.querySelector<HTMLButtonElement>('.listing-action') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalledWith(ENTRIES[1]);
    expect(activate).not.toHaveBeenCalled();
    // Indicating another empties the first.
    (rows_onStage(mount)[2] as HTMLElement).click();
    expect(row.querySelector('.listing-action')).toBeNull();
    expect(row.classList.contains('listing-indicated')).toBe(false);
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(activate).toHaveBeenCalledWith(ENTRIES[1]);
    expect(listing.indicated_get()).toBeNull();
  });

  it('a lead row keeps its single click and takes no verbs', () => {
    const activate = jest.fn();
    const { listing, mount } = listing_build({
      activate,
      actions: { width: '21em', of: (): ReadonlyArray<{ label: string; run: () => void }> => [{ label: 'OPEN', run: (): void => {} }] },
    });
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    const up: HTMLElement = rows_onStage(mount)[0] as HTMLElement;
    up.click();
    expect(activate).toHaveBeenCalledWith(UP);
    listing.row_indicate('..');
    expect(listing.indicated_get()).toBeNull();
    expect(up.querySelector('.listing-action')).toBeNull();
  });

  it('a readout lands beside the indicated row and nowhere else', () => {
    const { listing, mount } = listing_build({
      actions: { width: '21em', of: (): [] => [] },
    });
    listing.rows_set([{ key: '/x', rows: ENTRIES }], { field: '/x' });
    listing.readout_show('alpha', 'NOBODY');
    expect(mount.querySelector('.listing-readout')).toBeNull();
    listing.row_indicate('alpha');
    listing.readout_show('alpha', 'SHARED WITH x');
    expect(listing.row_element('alpha')?.querySelector('.listing-readout')?.textContent).toBe('SHARED WITH x');
    listing.readout_show('beta', 'STALE');
    expect(mount.querySelectorAll('.listing-readout')).toHaveLength(1);
  });
});

describe('a-selection-belongs-to-the-field', () => {
  function selectable(): { listing: Listing<Entry>; root: HTMLElement; mount: HTMLElement } {
    return listing_build({
      actions: { width: '21em', of: (): [] => [] },
      selection: {
        verbs: (rows: ReadonlyArray<[string, Entry]>): ReadonlyArray<{ label: string; run: () => void }> =>
          [{ label: `RM ${rows.length}`, run: (): void => {} }],
      },
    });
  }

  it('gathers on click while SELECT is on, and the bar reads the verbs', () => {
    const { listing, root, mount } = selectable();
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    listing.select_toggle(true);
    expect(root.querySelector('.files-select')?.textContent).toBe('SELECT ON');
    (rows_onStage(mount)[1] as HTMLElement).click();
    (rows_onStage(mount)[2] as HTMLElement).click();
    expect(listing.selection_get()).toEqual(['alpha', 'beta']);
    expect(listing.indicated_get()).toBeNull();
    expect(root.querySelector('.files-selection-bar')?.textContent).toBe('RM 2');
    expect(root.querySelector('.pane-state')?.textContent).toBe('SELECT · 2 SELECTED');
    // The lead row is not a member of anything.
    (rows_onStage(mount)[0] as HTMLElement).click();
    expect(listing.selection_get()).toEqual(['alpha', 'beta']);
  });

  it('survives a filter and a re-listing of the same field, and clears on another', async () => {
    const { listing, root, mount } = selectable();
    listing.rows_set([{ key: '/x', rows: ENTRIES }], { field: '/x' });
    listing.select_toggle(true);
    (rows_onStage(mount)[0] as HTMLElement).click();
    (rows_onStage(mount)[1] as HTMLElement).click();
    expect(listing.selection_get()).toEqual(['alpha', 'beta']);

    root.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'filter', text: 'alp' } }));
    await frame();
    expect(names_onStage(mount)).toEqual(['alpha']);
    expect(listing.selection_get()).toEqual(['alpha', 'beta']);
    expect(root.querySelector('.pane-state')?.textContent).toBe('SELECT · FILTERED 1/3 · 2 SELECTED · 1 SHOWN');

    root.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'filter', text: '' } }));
    await frame();
    listing.rows_set([{ key: '/x', rows: [...ENTRIES] }], { field: '/x' });
    expect(listing.selection_get()).toEqual(['alpha', 'beta']);
    expect(listing.row_element('alpha')?.classList.contains('listing-selected')).toBe(true);

    listing.select_toggle(false);
    expect(listing.selection_get()).toEqual(['alpha', 'beta']);

    listing.rows_set([{ key: '/y', rows: ENTRIES }], { field: '/y' });
    expect(listing.selection_get()).toEqual([]);
  });
});

describe('order', () => {
  it('sorts by the compare value, not the displayed text', async () => {
    const { listing, root, mount } = listing_build();
    listing.rows_set([{ key: '/x', rows: ENTRIES }], { field: '/x' });
    expect(names_onStage(mount)).toEqual(['alpha', 'beta', 'gamma']);
    root.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'sort', key: 'size', dir: 'desc' } }));
    await frame();
    // As text, '100B' < '20B'; as bytes, 100 > 20.
    expect(names_onStage(mount)).toEqual(['beta', 'gamma', 'alpha']);
  });

  it('the FILTER block reads the strip', () => {
    const { listing, root } = listing_build();
    const block: HTMLElement = root.querySelector<HTMLElement>('.files-filter') as HTMLElement;
    expect(block.classList.contains('rail-off')).toBe(true);
    block.click();
    expect(block.textContent).toBe('FILTER ON');
    expect(block.classList.contains('rail-off')).toBe(false);
    listing.filter_toggle(false);
    expect(block.textContent).toBe('FILTER OFF');
  });
});

describe('the state line', () => {
  it('composes the default line from typed parts', () => {
    const parts: ListingStateParts = { filter: 'FILTERED 1/3', selecting: false, selected: 0, shown: 0 };
    expect(listingState_compose(parts)).toBe('FILTERED 1/3');
    expect(listingState_compose({ ...parts, filter: '', selected: 2, shown: 2 })).toBe('2 SELECTED');
  });

  it('a composer may prepend its own words or decline to write', () => {
    const state = jest.fn((parts: ListingStateParts): string | null => (parts.selected > 0 ? null : `CWD · ${parts.filter}`));
    const { listing, root } = listing_build({ state });
    listing.rows_set([{ key: '/x', rows: ENTRIES }], { field: '/x' });
    expect(state).toHaveBeenCalledWith({ filter: '', selecting: false, selected: 0, shown: 0 });
    expect(root.querySelector('.pane-state')?.textContent).toBe('CWD · ');
  });
});

describe('a painter', () => {
  it('replaces the grid for a block and receives the rows in order', () => {
    const { listing, mount } = listing_build({ actions: { width: '21em', of: (): [] => [] } });
    const painted: string[][] = [];
    listing.painter_set((block: ListingBlock<Entry>, into: HTMLElement): void => {
      painted.push(block.rows.map((entry: Entry): string => entry.name));
      const cards: HTMLElement = document.createElement('div');
      cards.className = 'cards';
      into.appendChild(cards);
    });
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    expect(painted).toEqual([['alpha', 'beta', 'gamma']]);
    expect(mount.querySelector('.cards')).not.toBeNull();
    expect(mount.querySelector('.listing-row')).toBeNull();
    // The frame is still seated: the caps still sort what the painter draws.
    expect(mount.querySelector('.roster-caps')).not.toBeNull();
    listing.painter_set(null);
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    expect(rows_onStage(mount)).toHaveLength(4);
  });
});

describe('verbs declared after construction', () => {
  it('mint the track, rewrite the template and repaint; withdrawn, they take the track with them', () => {
    const { listing, mount } = listing_build();
    listing.rows_set([{ key: '/x', lead: [UP], rows: ENTRIES }], { field: '/x' });
    expect(rows_onStage(mount).every((row: HTMLElement): boolean => row.children.length === 3)).toBe(true);
    listing.actions_declare({ width: '21em', of: (): [] => [] });
    expect(mount.style.getPropertyValue('--roster-cols')).toBe('1.4em 1fr 6em 21em');
    expect(rows_onStage(mount).every((row: HTMLElement): boolean => row.children.length === 4)).toBe(true);
    expect(mount.querySelectorAll('.listing-actions')).toHaveLength(4);
    listing.actions_declare(null);
    expect(mount.style.getPropertyValue('--roster-cols')).toBe('1.4em 1fr 6em');
    expect(rows_onStage(mount).every((row: HTMLElement): boolean => row.children.length === 3)).toBe(true);
  });
});

describe('a level beneath a level', () => {
  const SERIES_TRAITS: ReadonlyArray<ListingTrait<Series>> = [
    { key: 'series', label: 'SERIES', className: 'series', width: '1fr', cell: (series: Series): string => series.uid },
    { key: 'modality', label: 'MODALITY', className: 'modality', width: '4em', cell: (series: Series): string => series.modality },
  ];
  const STUDY_TRAITS: ReadonlyArray<ListingTrait<Study>> = [
    { key: 'fold', label: '', className: 'fold', width: '1.4em', capped: false, cell: (): string => '▸' },
    { key: 'study', label: 'STUDY', className: 'study', width: '1fr', cell: (study: Study): string => study.description },
  ];
  const STUDIES: Study[] = [
    { uid: 's1', description: 'brain', series: [{ uid: 's1a', modality: 'MR' }, { uid: 's1b', modality: 'CT' }] },
    { uid: 's2', description: 'knee', series: [{ uid: 's2a', modality: 'MR' }] },
  ];

  function levels_build(): { listing: Listing<Study>; root: HTMLElement; mount: HTMLElement } {
    const { root, mount } = chrome_build('pacs');
    const listing: Listing<Study> = new Listing<Study>({
      mount,
      traits: STUDY_TRAITS,
      key: (study: Study): string => study.uid,
      chrome: { root, prefix: 'pacs' },
      child: listingChild_declare(
        (study: Study): ReadonlyArray<Series> => study.series,
        { traits: SERIES_TRAITS, key: (series: Series): string => series.uid },
      ),
    });
    return { listing, root, mount };
  }

  it('mints the child caps per open group, on the child grid, and reads the parent filter', async () => {
    const { listing, root, mount } = levels_build();
    listing.rows_set([{ key: 'q', rows: STUDIES }], { field: 'q' });
    expect(mount.querySelectorAll('.listing-level')).toHaveLength(0);
    // Activating a study folds it open: its series list beneath it with caps of its own.
    (listing.row_element('s1') as HTMLElement).click();
    await frame();
    const level: HTMLElement | null = mount.querySelector<HTMLElement>('.listing-level');
    expect(level).not.toBeNull();
    expect((level as HTMLElement).style.getPropertyValue('--roster-cols')).toBe('1fr 4em');
    expect((level as HTMLElement).querySelectorAll('.roster-caps')).toHaveLength(1);
    expect((level as HTMLElement).querySelectorAll('.listing-row')).toHaveLength(2);
    expect(mount.querySelectorAll('.roster-caps')).toHaveLength(2);
    expect(listing.row_element('s1')?.classList.contains('listing-open')).toBe(true);

    // One filter, read down the levels: the knee study does not match
    // 'CT' itself but its parent survives when a series does — and only
    // the matching series show under a parent that did not match.
    (listing.row_element('s2') as HTMLElement).click();
    await frame();
    root.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'filter', text: 'CT' } }));
    await frame();
    const studies: string[] = [...mount.querySelectorAll<HTMLElement>('.listing-rows > .listing-row .study')]
      .map((cell: HTMLElement): string => cell.textContent ?? '');
    expect(studies).toEqual(['brain']);
    const series: string[] = [...mount.querySelectorAll<HTMLElement>('.listing-level .series')]
      .map((cell: HTMLElement): string => cell.textContent ?? '');
    expect(series).toEqual(['s1b']);
    expect(root.querySelector('.pane-state')?.textContent).toBe('FILTERED 1/2');
  });

  it('a sort names its level and the other levels ignore it', async () => {
    const { listing, root, mount } = levels_build();
    listing.rows_set([{ key: 'q', rows: STUDIES }], { field: 'q' });
    (listing.row_element('s1') as HTMLElement).click();
    await frame();
    root.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'sort', key: 'modality', dir: 'asc' } }));
    await frame();
    const series: string[] = [...mount.querySelectorAll<HTMLElement>('.listing-level .series')]
      .map((cell: HTMLElement): string => cell.textContent ?? '');
    expect(series).toEqual(['s1b', 's1a']);
    const lit: HTMLElement | null = mount.querySelector<HTMLElement>('.listing-level .roster-cap.roster-active');
    expect(lit?.dataset['key']).toBe('modality');
    expect(mount.querySelector('.listing-rows > .listing-row .study')?.textContent).toBe('brain');
  });
});
