/**
 * @file Feed comments command logic.
 * @module
 */
import {
  feedComments_list,
  feedComment_create,
  feedComment_delete,
  feedComment_update,
} from '@fnndsc/salsa';
import type { FeedComment } from '@fnndsc/salsa';
import { Result } from '@fnndsc/cumin';

export type { FeedComment };

/**
 * Lists the comments on a feed.
 *
 * @param feedId - The feed ID.
 * @returns Result wrapping the comments.
 */
export async function feed_commentsList(feedId: number): Promise<Result<FeedComment[]>> {
  return feedComments_list(feedId);
}

/**
 * Creates a comment on a feed.
 *
 * @param feedId - The feed ID.
 * @param data - Comment title and/or content.
 * @returns Result wrapping the created comment.
 */
export async function feed_commentCreate(
  feedId: number,
  data: { title?: string; content?: string }
): Promise<Result<FeedComment>> {
  return feedComment_create(feedId, data);
}

/**
 * Deletes a feed comment.
 *
 * @param feedId - The feed ID.
 * @param commentId - The comment ID.
 * @returns Result indicating success.
 */
export async function feed_commentDelete(feedId: number, commentId: number): Promise<Result<boolean>> {
  return feedComment_delete(feedId, commentId);
}

/**
 * Updates a feed comment.
 *
 * @param feedId - The feed ID.
 * @param commentId - The comment ID.
 * @param data - Updated title and/or content.
 * @returns Result indicating success.
 */
export async function feed_commentUpdate(
  feedId: number,
  commentId: number,
  data: { title?: string; content?: string }
): Promise<Result<boolean>> {
  return feedComment_update(feedId, commentId, data);
}
