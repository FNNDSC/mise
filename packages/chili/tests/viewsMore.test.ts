/**
 * View-layer tests for compute and feed renderers.
 */
jest.mock('../src/screen/screen', () => ({
  screen: { table_output: jest.fn(() => 'TABLE_OUTPUT') },
}));

import { computeList_render } from '../src/views/compute';
import {
  feedList_render,
  feedCreate_render,
  feedNote_render,
  feedComments_render,
} from '../src/views/feed';
import type { ComputeResource } from '@fnndsc/cumin';
import type { Feed } from '../src/models/feed';

const compute = [
  { id: 1, name: 'host', compute_url: 'http://c/', description: 'main' },
  { id: 2, name: 'moc', compute_url: null, description: null },
] as unknown as ComputeResource[];

describe('computeList_render', () => {
  it('reports when there are none', () => {
    expect(computeList_render([])).toContain('No compute resources');
  });
  it('renders CSV', () => {
    const out = computeList_render(compute, { csv: true });
    expect(out.split('\n')[0]).toBe('"ID","NAME","URL","DESCRIPTION"');
    expect(out).toContain('"host"');
  });
  it('renders a padded table with header + divider', () => {
    const out = computeList_render(compute, { table: true });
    const lines = out.split('\n');
    expect(lines[0]).toContain('NAME');
    expect(lines[1]).toContain('─');
    expect(lines).toHaveLength(4); // header + divider + 2 rows
  });
  it('renders the default columnar list', () => {
    const out = computeList_render(compute);
    expect(out).toContain('host');
    expect(out).toContain('http://c/');
  });
});

const feeds = [
  { id: 1, name: 'brain', creation_date: '2026-01-01T00:00:00.000Z', owner_username: 'chris' },
] as unknown as Feed[];

describe('feedList_render', () => {
  it('reports when there are none', () => {
    expect(feedList_render([], [])).toContain('No feeds found');
  });
  it('truncates ISO creation dates in the default list', () => {
    const out = feedList_render(feeds, []);
    expect(out).toContain('2026-01-01T00:00:00'); // truncated to 19 chars
    expect(out).not.toContain('.000Z');
  });
  it('renders CSV', () => {
    const out = feedList_render(feeds, ['id', 'name'], { csv: true });
    expect(out.split('\n')[0]).toBe('"ID","NAME"');
  });
  it('delegates to screen.table_output for table format', () => {
    expect(feedList_render(feeds, ['id'], { table: true })).toBe('TABLE_OUTPUT');
  });
});

describe('feed detail renders', () => {
  it('feedCreate_render', () => {
    const out = feedCreate_render({ id: 7, name: 'f' } as never);
    expect(out).toContain('Feed created successfully');
    expect(out).toContain('7');
  });
  it('feedNote_render with and without a title', () => {
    expect(feedNote_render({ title: 'T', content: 'C' } as never, 3)).toContain('Title:');
    const noTitle = feedNote_render({ content: '' } as never, 3);
    expect(noTitle).toContain('(empty)');
  });
  it('feedComments_render empty and populated', () => {
    expect(feedComments_render([], 3)).toContain('No comments');
    const out = feedComments_render(
      [{ id: 1, owner_username: 'chris', title: 'Hi', content: 'body' }] as never,
      3
    );
    // (header text is double-chalk-styled -> stripped by the mock; assert the
    // single-styled parts that survive)
    expect(out).toContain('chris');
    expect(out).toContain('body');
  });
});
