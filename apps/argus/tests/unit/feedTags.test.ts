/**
 * @jest-environment jsdom
 *
 * @file A feed's tags in ARGUS: the lines that hang one (mkdir first for a
 * new tag), the models they are read from, the title cell's marks, the
 * filter-only `tag:` term, and the choose question's pills.
 */
import { describe, it, expect } from '@jest/globals';
import type { FeedListEntry } from '@fnndsc/menu';
import { tagLines_compose, tagNames_of } from '../../src/app/tags.js';
import { feedTags_of } from '../../src/app/feedRows.js';
import { feedTitle_build } from '../../src/features/dag/roster.js';
import { RosterOrder } from '../../src/features/roster/order.js';
import { paneAsk_open } from '../../src/features/ask/paneAsk.js';
import type { ExecuteOutcome } from '../../src/calypso/client.js';

const outcome = (model: unknown): ExecuteOutcome => ({ envelopes: [{ status: 'ok', rendered: '', model } as never], liveChannels: new Set() });
const feed = (id: number, title: string, tags?: string[]): FeedListEntry => ({ id, title, owner: 'u', status: 'finishedSuccessfully', createdAt: '2026-10-01', ...(tags === undefined ? {} : { tags }) } as FeedListEntry);

describe('the lines a tag is hung by', () => {
  it('sets a known tag, and makes a new one first', () => {
    expect(tagLines_compose(12, 'urgent', ['urgent'])).toEqual(["setfattr -n tag -v 'urgent' feed_12"]);
    expect(tagLines_compose(12, "it's new", ['urgent'])).toEqual(["mkdir '/proc/tags/it\\'s new'", "setfattr -n tag -v 'it\\'s new' feed_12"]);
  });

  it('reads the tag names from ls /proc/tags and a feed\'s tags from getfattr', () => {
    expect(tagNames_of(outcome({ kind: 'fs.listing', data: [{ path: '/proc/tags', items: [{ name: 'urgent' }, { name: 'qc' }] }] }))).toEqual(['urgent', 'qc']);
    expect(tagNames_of(outcome({ kind: 'fs.cwd', data: {} }))).toEqual([]);
    expect(feedTags_of(outcome({ kind: 'fs.xattr', data: [{ path: 'feed_12', feedId: 12, tags: ['urgent'] }] }))).toEqual(['urgent']);
  });
});

describe('the title cell', () => {
  it('is text without tags, and the title then a mark per tag with its × when tagged', () => {
    expect(feedTitle_build(feed(1, 'plain'))).toBe('plain');
    const cell = feedTitle_build(feed(2, 'run', ['urgent', 'qc'])) as HTMLElement;
    expect(cell.className).toBe('feedlist-title feedlist-titled');
    expect([...cell.querySelectorAll('.feedlist-tag')].map((m) => (m as HTMLElement).dataset['tag'])).toEqual(['urgent', 'qc']);
    expect(cell.querySelectorAll('.feedlist-tag-x').length).toBe(2);
  });
});

describe('a filter term that is not a column', () => {
  it('keeps the rows whose term holds the text, and a bare word searches it too', () => {
    (globalThis as unknown as { requestAnimationFrame: (f: () => void) => void }).requestAnimationFrame = (f) => f();
    const order = new RosterOrder<FeedListEntry>([{ key: 'title', label: 'TITLE' }], (row, key) => String((row as unknown as Record<string, unknown>)[key] ?? ''), () => undefined, undefined, 0, true,
      [{ key: 'tag', value: (row) => (row.tags ?? []).join(' ') }]);
    const rows = [feed(1, 'a', ['urgent']), feed(2, 'b', ['qc']), feed(3, 'urgent run')];
    order.filter_set('tag:urgent');
    expect(order.apply(rows).map((r) => r.id)).toEqual([1]);
    order.filter_set('urgent');
    expect(order.apply(rows).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe('a choose question', () => {
  it('offers pills (a held one dimmed and unpressable) and answers with the pressed one, DONE ending it', async () => {
    const pane = document.createElement('div');
    document.body.appendChild(pane);
    const answered = paneAsk_open(pane, { kind: 'choose', message: 'Tag feed_12: ', choices: [{ value: 'urgent', held: true }, { value: 'qc' }], commit: 'TAG', close: 'DONE' });
    const pills = [...pane.querySelectorAll<HTMLButtonElement>('.ask-bar-choice')];
    expect(pills.map((p) => [p.textContent, p.disabled])).toEqual([['urgent', true], ['qc', false]]);
    expect(pane.querySelector('.ask-bar-abandon')?.textContent).toBe('DONE');
    pills[1].click();
    expect(await answered).toBe('qc');
    const again = paneAsk_open(pane, { kind: 'choose', message: 'x', choices: [], close: 'DONE' });
    (pane.querySelector('.ask-bar-abandon') as HTMLButtonElement).click();
    expect(await again).toBeNull();
  });
});
