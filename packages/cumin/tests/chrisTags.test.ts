/**
 * @file Tests for a feed's tags: list, add (reusing the user's tag or
 * making one, idempotent), remove (the tagging goes, the tag stays).
 * Connection mocked at the client boundary.
 */
jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { feedTags_list, feedTag_add, feedTag_remove, feedTags_byFeed, feedTagsMap_forget, tags_index, tag_create, tag_delete, tag_rename, TAG_COLOR_DEFAULT, TAGS_MAP_TTL_MS } from '../src/feeds/chrisTags';
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

  it('refuses a tag the user has not made, naming the cure, and makes none', async () => {
    const fake = fake_make();
    mockClientGet.mockResolvedValue(client_make(fake));
    expect((await feedTag_add(12, 'new')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('| new: No such tag (mkdir /proc/tags/new)');
    expect(fake.created).toEqual([]);
    expect(fake.added).toEqual([]);
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

describe('feedTags_byFeed', () => {
  function mapClient_make(reads: { count: number }): unknown {
    const tag = (id: number, name: string, feeds: number[]) => ({
      data: { id, name, color: '#888888' },
      getTaggedFeeds: async () => { reads.count += 1; return list_make(feeds.map((f) => ({ id: f }))); },
    });
    return {
      getTags: async () => { reads.count += 1; return { ...list_make([]), getItems: () => [tag(1, 'urgent', [12, 13]), tag(2, 'review', [12])] }; },
    };
  }

  beforeEach(() => feedTagsMap_forget());

  it("maps every feed to its tags in one read per tag, never one per feed", async () => {
    const reads = { count: 0 };
    mockClientGet.mockResolvedValue(mapClient_make(reads));
    const result = await feedTags_byFeed(1_000);
    expect(result.ok && [...result.value.entries()]).toEqual([[12, ['urgent', 'review']], [13, ['urgent']]]);
    expect(reads.count).toBe(3);
  });

  it('serves the map within its time and reads again after, or after a change', async () => {
    const reads = { count: 0 };
    mockClientGet.mockResolvedValue(mapClient_make(reads));
    await feedTags_byFeed(1_000);
    await feedTags_byFeed(1_000 + TAGS_MAP_TTL_MS - 1);
    expect(reads.count).toBe(3);
    await feedTags_byFeed(1_000 + TAGS_MAP_TTL_MS);
    expect(reads.count).toBe(6);
    feedTagsMap_forget();
    await feedTags_byFeed(1_000 + TAGS_MAP_TTL_MS + 1);
    expect(reads.count).toBe(9);
  });

  it('says so when not connected or CUBE refuses', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await feedTags_byFeed()).ok).toBe(false);
    mockClientGet.mockResolvedValue({ getTags: async () => { throw new Error('down'); } });
    expect((await feedTags_byFeed()).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/Failed to read the tags: down/);
  });
});

describe('the vocabulary: tags_index, tag_create, tag_delete, tag_rename', () => {
  interface VocabFake { tags: Array<{ id: number; name: string; color: string; feeds: number[] }>; created: string[]; deleted: number[]; renamed: Array<[number, string]> }
  function vocabClient_make(fake: VocabFake): unknown {
    const resource = (row: VocabFake['tags'][number]) => ({
      data: { id: row.id, name: row.name, color: row.color },
      getTaggedFeeds: async () => list_make(row.feeds.map((f) => ({ id: f }))),
      delete: async () => { fake.deleted.push(row.id); },
      put: async (data: { name: string; color: string }) => { fake.renamed.push([row.id, data.name]); putColors.push(data.color); },
    });
    return {
      getTags: async (search: { name?: string }) => {
        const rows = fake.tags.filter((t) => search.name === undefined || t.name === search.name);
        return { ...list_make(rows.map((t) => ({ id: t.id, name: t.name, color: t.color }))), getItems: () => rows.map(resource) };
      },
      createTag: async (data: { name: string; color: string }) => { fake.created.push(data.name); return { data: { id: 50, ...data } }; },
    };
  }
  const putColors: string[] = [];
  const vocab = (): VocabFake => ({ tags: [{ id: 1, name: 'urgent', color: '#888888', feeds: [12, 13] }, { id: 2, name: 'spare', color: '#888888', feeds: [] }], created: [], deleted: [], renamed: [] });

  beforeEach(() => feedTagsMap_forget());

  it('lists every tag the user has, an unworn one too, with the feeds wearing each', async () => {
    mockClientGet.mockResolvedValue(vocabClient_make(vocab()));
    const result = await tags_index(1_000);
    expect(result.ok && [...result.value.values()].map((t) => [t.name, t.feeds])).toEqual([['urgent', [12, 13]], ['spare', []]]);
  });

  it('makes a tag in the default colour, and refuses a name the user has: File exists', async () => {
    const fake = vocab();
    mockClientGet.mockResolvedValue(vocabClient_make(fake));
    expect((await tag_create('qc')).ok).toBe(true);
    expect(fake.created).toEqual(['qc']);
    expect((await tag_create('urgent')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('| urgent: File exists');
    expect(TAG_COLOR_DEFAULT).toBe('#888888');
  });

  it('deletes an unworn tag, and refuses one feeds wear: Directory not empty', async () => {
    const fake = vocab();
    mockClientGet.mockResolvedValue(vocabClient_make(fake));
    expect((await tag_delete('spare')).ok).toBe(true);
    expect(fake.deleted).toEqual([2]);
    expect((await tag_delete('urgent')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('| urgent: Directory not empty (2 feeds wear it)');
    expect((await tag_delete('nope')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('| nope: No such file or directory');
  });

  it('renames a tag, and refuses a name already taken', async () => {
    const fake = vocab();
    mockClientGet.mockResolvedValue(vocabClient_make(fake));
    expect((await tag_rename('urgent', 'URGENT')).ok).toBe(true);
    expect(fake.renamed).toEqual([[1, 'URGENT']]);
    expect(putColors).toEqual(['#888888']);
    expect((await tag_rename('urgent', 'spare')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('| spare: File exists');
  });
});
