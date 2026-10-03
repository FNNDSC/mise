/**
 * @file A feed's tags: CUBE's freeform labels, which a user owns and hangs
 * on feeds through taggings. The kernel speaks them as extended attributes
 * (`getfattr`, `setfattr`); this is the adapter beneath.
 *
 * A tag is the user's own object (a name and a colour); a tagging joins one
 * tag to one feed. Adding a tag by name reuses the user's tag of that name,
 * or makes one; removing it from a feed deletes the tagging and leaves the
 * tag, which may hang on other feeds.
 *
 * @module
 */
import {
  itemData_get,
  listData_get,
  type Client,
  type Feed,
  type FeedTagList,
  type FeedTaggingList,
  type TagList,
  type Tagging,
} from "../chrisapi/adapter.js";
import { chrisConnection } from "../connect/chrisConnection.js";
import { collectionPage_wrap, listPages_drain, type ListPage } from "../chrisapi/contract.js";
import { errorStack } from "../error/errorStack.js";
import { Result, Ok, Err } from "../utils/result.js";

/** One tag as a feed wears it. */
export interface FeedTag {
  id: number;
  name: string;
  color: string;
}

/** The colour a tag is made in when the kernel makes it: CUBE requires one. */
export const TAG_COLOR_DEFAULT: string = '#888888';

/**
 * The connected client and the feed, or the reason there are none.
 *
 * @param feedId - The feed.
 * @param doing - What was being done, for the error.
 * @returns The client and feed, or null with the error stacked.
 */
async function feed_reach(feedId: number, doing: string): Promise<{ client: Client; feed: Feed } | null> {
  const client: Client | null = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS.');
    return null;
  }
  const feed: Feed | null = await client.getFeed(feedId);
  if (!feed) {
    errorStack.stack_push('error', `${doing}: feed ${feedId} not found.`);
    return null;
  }
  return { client, feed };
}

/**
 * Every tag a feed wears.
 *
 * @param feed - The feed.
 * @returns Its tags.
 */
async function tags_drain(feed: Feed): Promise<FeedTag[]> {
  return listPages_drain(async (offset: number, limit: number): Promise<ListPage<FeedTag>> => {
    const list: FeedTagList = await feed.getTags({ limit, offset });
    return collectionPage_wrap(list, listData_get<FeedTag>(list));
  });
}

/**
 * Lists the tags a feed wears.
 *
 * @param feedId - The feed.
 * @returns Its tags, by name.
 */
export async function feedTags_list(feedId: number): Promise<Result<FeedTag[]>> {
  try {
    const reached = await feed_reach(feedId, 'tags');
    if (reached === null) return Err();
    return Ok(await tags_drain(reached.feed));
  } catch (error: unknown) {
    errorStack.stack_push('error', `Failed to list tags of feed ${feedId}: ${error instanceof Error ? error.message : String(error)}`);
    return Err();
  }
}

/**
 * Hangs a tag on a feed by name: the user's tag of that name, made if it
 * does not exist yet.
 *
 * @param feedId - The feed.
 * @param name - The tag's name.
 * @returns True when it was added, false when the feed already wore it.
 */
export async function feedTag_add(feedId: number, name: string): Promise<Result<boolean>> {
  try {
    const reached = await feed_reach(feedId, 'tag');
    if (reached === null) return Err();
    const worn: FeedTag[] = await tags_drain(reached.feed);
    if (worn.some((tag: FeedTag): boolean => tag.name === name)) return Ok(false);
    // CUBE lists a user their own tags: a name found here is theirs.
    const owned: TagList = await reached.client.getTags({ name });
    const found: FeedTag | undefined = listData_get<FeedTag>(owned).find((tag: FeedTag): boolean => tag.name === name);
    const tagId: number | undefined = found !== undefined
      ? found.id
      : itemData_get<FeedTag>(await reached.client.createTag({ name, color: TAG_COLOR_DEFAULT }))?.id;
    if (tagId === undefined) {
      errorStack.stack_push('error', `tag: CUBE made no tag named ${name}.`);
      return Err();
    }
    await reached.feed.addTagging(tagId);
    return Ok(true);
  } catch (error: unknown) {
    errorStack.stack_push('error', `Failed to tag feed ${feedId} with ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return Err();
  }
}

/**
 * Takes a tag off a feed by name: the tagging goes, the tag stays (it may
 * hang on other feeds).
 *
 * @param feedId - The feed.
 * @param name - The tag's name.
 * @returns True when it was removed, false when the feed did not wear it.
 */
export async function feedTag_remove(feedId: number, name: string): Promise<Result<boolean>> {
  try {
    const reached = await feed_reach(feedId, 'untag');
    if (reached === null) return Err();
    const tag: FeedTag | undefined = (await tags_drain(reached.feed)).find((one: FeedTag): boolean => one.name === name);
    if (tag === undefined) return Ok(false);
    const taggings: FeedTaggingList = await reached.feed.getTaggings({ limit: 100, offset: 0 });
    const tagging: Tagging | undefined = ((taggings.getItems() ?? []) as Tagging[])
      .find((one: Tagging): boolean => itemData_get<{ tag_id?: number }>(one)?.tag_id === tag.id);
    if (tagging === undefined) return Ok(false);
    await tagging.delete();
    return Ok(true);
  } catch (error: unknown) {
    errorStack.stack_push('error', `Failed to untag feed ${feedId} of ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return Err();
  }
}
