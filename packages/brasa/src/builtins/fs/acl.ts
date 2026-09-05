/**
 * @file `setfacl` and `getfacl` — a feed's access list.
 *
 * Sharing a feed is, in POSIX terms, an access control entry, and a shell
 * already has the verbs for it. `share X with Y` is a sentence; it reads
 * as a natural-language assist and lands nowhere in a terminal.
 *
 * The capability itself lives in the kernel (`feed_share`,
 * `feedShares_list`). This is its shell face.
 *
 * @module
 */
import {
  CommandEnvelope, envelope_ok, envelope_error, errorStack,
  feed_share, feedShares_list, type Result, type StackMessage,
} from '@fnndsc/cumin';
import {
  aclTarget_resolve, acl_render, setfaclArgs_parse,
  GETFACL_USAGE, type SetfaclArgs,
} from './acl.args.js';

/**
 * Adds or modifies an access control entry on a feed.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope naming what was granted.
 */
export async function builtin_setfacl(args: string[]): Promise<CommandEnvelope> {
  const parsed: SetfaclArgs = setfaclArgs_parse(args);
  if (parsed.error !== null) return envelope_error(parsed.error);

  if (parsed.remove !== null) {
    // Refused by name rather than silently ignored: CUBE models the grant
    // but mise has no revocation to offer yet, and a shell that appears to
    // strip an entry it cannot strip is worse than one that says so.
    return envelope_error('setfacl: -x is not supported yet — mise cannot revoke a feed grant');
  }

  const entry = parsed.modify;
  if (entry === null) return envelope_error(parsed.error ?? 'setfacl: nothing to do');
  if (!entry.perms.includes('r')) {
    return envelope_error(`setfacl: '${entry.perms}' grants no read — CUBE shares a feed for reading`);
  }

  const granted: string[] = [];
  for (const path of parsed.paths) {
    const feedID: number | null = aclTarget_resolve(path);
    if (feedID === null) {
      return envelope_error(`setfacl: '${path}' does not name a feed`);
    }
    const outcome: Result<boolean> = await feed_share(feedID, entry.username);
    if (!outcome.ok) {
      const error: StackMessage | undefined = errorStack.stack_pop();
      return envelope_error(error?.message ?? `setfacl: could not grant ${entry.username} access to feed ${feedID}`);
    }
    granted.push(`feed_${feedID}`);
  }

  return envelope_ok(
    `${entry.username} granted read on ${granted.join(' ')}`,
    { kind: 'fs.acl', data: { usernames: [entry.username], targets: granted } },
  );
}

/**
 * Reports a feed's access list, in `getfacl`'s own shape.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope carrying the rendered list.
 */
export async function builtin_getfacl(args: string[]): Promise<CommandEnvelope> {
  const paths: string[] = args.filter((token: string): boolean => !token.startsWith('-'));
  if (paths.length === 0) return envelope_error(GETFACL_USAGE);

  const blocks: string[] = [];
  const model: Array<{ path: string; usernames: string[] }> = [];
  for (const path of paths) {
    const feedID: number | null = aclTarget_resolve(path);
    if (feedID === null) {
      return envelope_error(`getfacl: '${path}' does not name a feed`);
    }
    const held: Result<string[]> = await feedShares_list(feedID);
    if (!held.ok) {
      const error: StackMessage | undefined = errorStack.stack_pop();
      return envelope_error(error?.message ?? `getfacl: could not read the access list of feed ${feedID}`);
    }
    blocks.push(acl_render(path, null, held.value));
    model.push({ path, usernames: held.value });
  }

  return envelope_ok(blocks.join('\n\n'), { kind: 'fs.acl', data: model });
}
