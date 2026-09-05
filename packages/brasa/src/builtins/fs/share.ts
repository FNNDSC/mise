/**
 * @file `share` — grant another identity access to a feed.
 *
 * Sharing was a capability the kernel did not have, so a caller that
 * needed it reached past mise to CUBE's REST directly. That is exactly
 * backwards: a missing wrapper is the work. The operation now lives in
 * the kernel, this exposes it, and every surface gets it from here.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error, errorStack, feed_share, feedShares_list, type Result, type StackMessage } from '@fnndsc/cumin';
import { shareArgs_parse, shareTarget_resolve, SHARE_USAGE, type ShareArgs } from './share.args.js';

/**
 * Grants an identity access to a feed, or reports who already has it.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope naming what was granted, or who holds access.
 */
export async function builtin_share(args: string[]): Promise<CommandEnvelope> {
  const parsed: ShareArgs = shareArgs_parse(args);
  if (parsed.target === null) {
    return envelope_error(SHARE_USAGE);
  }

  const feedID: number | null = shareTarget_resolve(parsed.target);
  if (feedID === null) {
    return envelope_error(`share: '${parsed.target}' does not name a feed`);
  }

  if (parsed.username === null) {
    const held: Result<string[]> = await feedShares_list(feedID);
    if (!held.ok) {
      const error: StackMessage | undefined = errorStack.stack_pop();
      return envelope_error(error?.message ?? `share: could not read the shares of feed ${feedID}`);
    }
    const rendered: string = held.value.length === 0
      ? `feed ${feedID} is shared with nobody`
      : `feed ${feedID} is shared with ${held.value.join(' ')}`;
    return envelope_ok(rendered, { kind: 'feed.shares', data: { feedID, usernames: held.value } });
  }

  const granted: Result<boolean> = await feed_share(feedID, parsed.username);
  if (!granted.ok) {
    const error: StackMessage | undefined = errorStack.stack_pop();
    return envelope_error(error?.message ?? `share: could not share feed ${feedID} with ${parsed.username}`);
  }
  return envelope_ok(
    `feed ${feedID} shared with ${parsed.username}`,
    { kind: 'feed.shares', data: { feedID, usernames: [parsed.username] } },
  );
}
