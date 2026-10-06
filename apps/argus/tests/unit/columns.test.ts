/**
 * @file Columns sized by hand: the floor a column keeps, the expanse that
 * is never sized, the device's memory, and the template that follows.
 */
import { describe, it, expect } from '@jest/globals';
import { floor_of, track_isExpanse, columns_read, column_write, boundary_drag, type ColumnStore } from '../../src/features/roster/columns.js';
import { listingTemplate_of } from '../../src/features/roster/listing.js';
import type { ListingTrait } from '../../src/features/roster/row.js';

function store_fake(): ColumnStore & { map: Map<string, string> } {
  const map: Map<string, string> = new Map();
  return {
    map,
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => { map.set(key, value); },
    removeItem: (key: string): void => { map.delete(key); },
  };
}

interface Row { id: string }
const TRAITS: ReadonlyArray<ListingTrait<Row>> = [
  { key: 'id', label: 'ID', width: '4em', cell: (): string => '' },
  { key: 'title', label: 'TITLE', width: 'minmax(12em, 24em)', cell: (): string => '' },
  { key: 'progress', label: 'PROGRESS', width: 'minmax(8em, 1fr)', cell: (): string => '' },
  { key: 'owner', label: 'OWNER', width: '7em', cell: (): string => '' },
];

describe('columns by hand', () => {
  it('knows the expanse and the floor a column keeps', () => {
    expect(track_isExpanse('minmax(8em, 1fr)')).toBe(true);
    expect(track_isExpanse('1fr')).toBe(true);
    expect(track_isExpanse('24em')).toBe(false);
    expect(floor_of('minmax(12em, 24em)')).toBe('12em');
    expect(floor_of('7em')).toBe('3em');
    expect(floor_of('minmax( 96px ,1fr)')).toBe('96px');
  });

  it('writes a sized column into the template in px; the expanse keeps its 1fr and only its minimum moves', () => {
    const plain: string = listingTemplate_of(TRAITS);
    expect(plain).toBe('4em minmax(12em, 24em) minmax(8em, 1fr) 7em');
    const sized: string = listingTemplate_of(TRAITS, undefined, new Map([['title', 300], ['progress', 500], ['owner', 90]]));
    expect(sized).toBe('4em 300px minmax(500px, 1fr) 90px');
  });

  it('remembers sizes per listing and trait, forgets on null, and survives a store that refuses', () => {
    const store = store_fake();
    column_write(store, 'runs', 'title', 300.4);
    column_write(store, 'runs', 'owner', 90);
    column_write(store, 'files', 'title', 200);
    expect(store.map.get('argus.columns.runs.title')).toBe('300');
    expect(columns_read(store, 'runs', ['id', 'title', 'owner'])).toEqual(new Map([['title', 300], ['owner', 90]]));
    expect(columns_read(store, 'files', ['title'])).toEqual(new Map([['title', 200]]));
    column_write(store, 'runs', 'title', null);
    expect(columns_read(store, 'runs', ['title'])).toEqual(new Map());
    store.map.set('argus.columns.runs.owner', 'wide');
    expect(columns_read(store, 'runs', ['owner'])).toEqual(new Map());
    const refusing: ColumnStore = { getItem: (): string => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('blocked'); }, removeItem: (): void => { throw new Error('blocked'); } };
    expect(columns_read(refusing, 'runs', ['title'])).toEqual(new Map());
    expect((): void => column_write(refusing, 'runs', 'title', 1)).not.toThrow();
    expect(columns_read(null, 'runs', ['title'])).toEqual(new Map());
  });
});

describe('a boundary follows the hand', () => {
  const fixed = (width: number, floor: number = 40) => ({ width, floor, expanse: false });
  const stretch = (width: number, floor: number = 120) => ({ width, floor, expanse: true });

  it('two fixed columns trade: dragging right widens the left one and narrows the right one by the same', () => {
    expect(boundary_drag(fixed(100), fixed(80), 30)).toEqual({ left: 130, right: 50, moved: 30 });
    expect(boundary_drag(fixed(100), fixed(80), -30)).toEqual({ left: 70, right: 110, moved: -30 });
  });

  it('the expanse on the left (NAME | TYPE): the right column\'s left edge follows the hand, the expanse gives or takes', () => {
    expect(boundary_drag(stretch(400), fixed(80), 30)).toEqual({ left: null, right: 50, moved: 30 });
    expect(boundary_drag(stretch(400), fixed(80), -50)).toEqual({ left: null, right: 130, moved: -50 });
  });

  it('the expanse on the right (TITLE | PROGRESS): the left column grows, the expanse gives', () => {
    expect(boundary_drag(fixed(200), stretch(300), 80)).toEqual({ left: 280, right: null, moved: 80 });
  });

  it('stops at either floor, so the boundary never runs past what a column can give', () => {
    expect(boundary_drag(fixed(100), fixed(80, 40), 90)).toEqual({ left: 140, right: 40, moved: 40 });
    expect(boundary_drag(fixed(100, 60), fixed(80), -90)).toEqual({ left: 60, right: 120, moved: -40 });
    expect(boundary_drag(stretch(150, 120), fixed(80), -90)).toEqual({ left: null, right: 110, moved: -30 });
  });

  it('never moves against the hand: a side with no room stops the boundary where it is', () => {
    // TITLE beside a PROGRESS already under its measured floor: the drag right does nothing, not a jump left.
    expect(boundary_drag(fixed(229, 211), fixed(158, 176), 80)).toEqual({ left: null, right: null, moved: 0 });
    expect(boundary_drag(fixed(100, 120), fixed(80), -30)).toEqual({ left: null, right: null, moved: 0 });
  });

  it('with no sizeable neighbour, the left column alone, within the expanse\'s slack', () => {
    expect(boundary_drag(fixed(100), null, 50, 20)).toEqual({ left: 120, right: null, moved: 20 });
  });
});
