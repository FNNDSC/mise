/**
 * @file Tests for a feed's tags: list, add (reusing the user's tag or
 * making one, idempotent), remove (the tagging goes, the tag stays).
 * Connection mocked at the client boundary.
 */
jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { feedTags_list, feedTag_add, feedTag_remove, TAG_COLOR_DEFAULT } from '../src/feeds/chrisTags';
import { errorStack } from '../src/error/errorStack';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

/** A list resource as chrisapi shapes it, one page. */
function list_make<T>(rows: T[]): { data: T[]; totalCount: number; hasNextPage: boolean } {
  return { data: rows, totalCount: rows.length, hasNextPage: false };
}

interface Fake {
  tags: Array<{ id: number; name: string; color: string }>;
  taggings: Array<{ id: number; tag_id: number }>;
  owned: Array<{ id: number; name: string; color: string }>;
  added: number[];
  deleted: number[];
  created: Array<{ name: string; color: string }>;
}

function client_make(fake: Fake): unknown {
  const feed = {
    getTags: async () => list_make(fake.tags),
    getTaggings: async () => ({ ...list_make(fake.taggings), getItems: () => fake.taggings.map((t) => ({ data: t, delete: async () => { fake.deleted.push(t.id); } })) }),
    addTagging: async (tagId: number) => { fake.added.push(tagId); return {}; },
  };
  return {
    getFeed: async (id: number) => (id === 12 ? feed : null),
    getTags: async (search: { name: string }) => list_make(fake.owned.filter((t) => t.name === search.name)),
    createTag: async (data: { name: string; color: string }) => { fake.created.push(data); return { data: { id: 99, ...data } }; },
  };
}

function fake_make(partial: Partial<Fake> = {}): Fake {
  return { tags: [], taggings: [], owned: [], added: [], deleted: [], created: [], ...partial };
}

beforeEach(() => {
  mockClientGet.mockReset();
  while (errorStack.stack_pop() !== undefined) { /* drain */ }
});

describe('feedTags_list', () => {
  it('lists the tags a feed wears', async () => {
    mockClientGet.mockResolvedValue(client_make(fake_make({ tags: [{ id: 1, name: 'urgent', color: '#f00' }] })));
    const result = await feedTags_list(12);
    expect(result.ok && result.value.map((t) => t.name)).toEqual(['urgent']);
  });

  it('says so when not connected, or the feed is not found', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await feedTags_list(12)).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/Not connected/);
    mockClientGet.mockResolvedValue(client_make(fake_make()));
    expect((await feedTags_list(5)).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/feed 5 not found/);
  });
});

describe('feedTag_add', () => {
  it("reuses the user's tag of that name", async () => {
    const fake = fake_make({ owned: [{ id: 7, name: 'review', color: '#0f0' }] });
    mockClientGet.mockResolvedValue(client_make(fake));
    const result = await feedTag_add(12, 'review');
    expect(result.ok && result.value).toBe(true);
    expect(fake.added).toEqual([7]);
    expect(fake.created).toEqual([]);
  });

  it('makes the tag when the user has none of that name', async () => {
    const fake = fake_make();
    mockClientGet.mockResolvedValue(client_make(fake));
    expect((await feedTag_add(12, 'new')).ok).toBe(true);
    expect(fake.created).toEqual([{ name: 'new', color: TAG_COLOR_DEFAULT }]);
    expect(fake.added).toEqual([99]);
  });

  it('is idempotent: a tag the feed already wears is not added twice', async () => {
    const fake = fake_make({ tags: [{ id: 7, name: 'review', color: '#0f0' }] });
    mockClientGet.mockResolvedValue(client_make(fake));
    const result = await feedTag_add(12, 'review');
    expect(result.ok && result.value).toBe(false);
    expect(fake.added).toEqual([]);
  });
});

describe('feedTag_remove', () => {
  it('deletes the tagging that joins the tag to the feed', async () => {
    const fake = fake_make({ tags: [{ id: 7, name: 'review', color: '#0f0' }], taggings: [{ id: 40, tag_id: 3 }, { id: 41, tag_id: 7 }] });
    mockClientGet.mockResolvedValue(client_make(fake));
    const result = await feedTag_remove(12, 'review');
    expect(result.ok && result.value).toBe(true);
    expect(fake.deleted).toEqual([41]);
  });

  it('answers false for a tag the feed does not wear', async () => {
    const fake = fake_make();
    mockClientGet.mockResolvedValue(client_make(fake));
    const result = await feedTag_remove(12, 'absent');
    expect(result.ok && result.value).toBe(false);
    expect(fake.deleted).toEqual([]);
  });

  it('stacks the error when CUBE refuses', async () => {
    mockClientGet.mockResolvedValue({ getFeed: async () => { throw new Error('boom'); } });
    expect((await feedTag_remove(12, 'x')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/Failed to untag feed 12 of x: boom/);
  });
});
