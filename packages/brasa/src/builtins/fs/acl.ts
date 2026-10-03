/**
 * @file `setfacl`, `getfacl` and `chmod` — a feed's access list.
 *
 * Sharing a feed is, in POSIX terms, an access control entry, and a shell
 * already has the verbs for it: a user (`u:`), a group (`g:`), and the other
 * entry (`o::r`, everyone: a public feed). `setfacl -x` withdraws a user's or
 * a group's grant, and `chmod o±r` is the other entry spelled as a mode.
 * `share X with Y` is a sentence; it lands nowhere in a terminal.
 *
 * The capability itself lives in the kernel (cumin `feed_share`,
 * `feedShare_group`, `feedShare_revoke`, `feedAccess_read`,
 * `feed_makePublic`, `feed_makePrivate`). This is its shell face.
 *
 * @module
 */
import {
  CommandEnvelope, envelope_ok, envelope_error, errorStack,
  feed_share, feedShare_group, feedShare_revoke, feedAccess_read, feed_makePublic, feed_makePrivate,
  type FeedAccess, type Result, type StackMessage,
} from '@fnndsc/cumin';
import {
  aclTarget_resolve, acl_render, chmodArgs_parse, setfaclArgs_parse,
  GETFACL_USAGE, type AclEntry, type AclRemoval, type SetfaclArgs,
} from './acl.args.js';

/**
 * Adds or modifies an access control entry on a feed.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope naming what was granted.
 */
export async function builtin_setfacl(args: string[]): Promise<CommandEnvelope> {
  let parsed: SetfaclArgs = setfaclArgs_parse(args);
  // A path and no entry names WHAT to share and not WITH WHOM, which is a
  // question rather than a usage error (an-absent-value-is-a-question). The
  // grant CUBE offers is read on a feed, so the only thing missing is the
  // identity: ask for it, and refuse as before when it is not answered.
  if (parsed.error !== null && entryless_is(args)) {
    const paths: string[] = args.filter((token: string): boolean => !token.startsWith('-'));
    const feedIDs: number[] = [];
    for (const path of paths) {
      const feedID: number | null = aclTarget_resolve(path);
      if (feedID === null) {
        return envelope_error(`setfacl: '${path}' does not name a feed\n`);
      }
      if (!feedIDs.includes(feedID)) feedIDs.push(feedID);
    }
    // One question for the whole set: a grant is per identity, and asking
    // who once for twenty feeds is the same answer twenty times.
    const who: string = (await who_ask(feedIDs)).trim();
    if (who === '') {
      const named: string = feedIDs.map((id: number): string => `feed_${id}`).join(' ');
      return envelope_error(`setfacl: nobody named; ${named} shared with no one new\n`);
    }
    parsed = setfaclArgs_parse(['-m', `u:${who}:r`, ...paths]);
  }
  if (parsed.error !== null) return envelope_error(`${parsed.error}\n`);

  const feedIDs: number[] = [];
  for (const path of parsed.paths) {
    const feedID: number | null = aclTarget_resolve(path);
    if (feedID === null) return envelope_error(`setfacl: '${path}' does not name a feed\n`);
    feedIDs.push(feedID);
  }
  if (parsed.remove !== null) return acl_remove(parsed.remove, feedIDs);
  if (parsed.modify === null) return envelope_error(`${parsed.error ?? 'setfacl: nothing to do'}\n`);
  return acl_apply(parsed.modify, feedIDs, 'setfacl');
}

/**
 * Applies one entry to feeds: a user or group granted read, or the other
 * entry making them public (`r`) or private (no `r`). `setfacl -m` and
 * `chmod o±r` both land here.
 *
 * @param entry - The entry.
 * @param feedIDs - The feeds.
 * @param verb - The verb, for its refusals.
 * @returns An envelope naming what changed.
 */
async function acl_apply(entry: AclEntry, feedIDs: number[], verb: string): Promise<CommandEnvelope> {
  const reads: boolean = entry.perms.includes('r');
  if (entry.kind !== 'other' && !reads) {
    return envelope_error(`${verb}: '${entry.perms}' grants no read — CUBE shares a feed for reading (setfacl -x withdraws a grant)\n`);
  }
  const done: string[] = [];
  for (const feedID of feedIDs) {
    const outcome: Result<boolean> = entry.kind === 'user'
      ? await feed_share(feedID, entry.name)
      : entry.kind === 'group'
        ? await feedShare_group(feedID, entry.name)
        : reads ? await feed_makePublic(feedID) : await feed_makePrivate(feedID);
    if (!outcome.ok) {
      const error: StackMessage | undefined = errorStack.stack_pop();
      return envelope_error(`${error?.message ?? `${verb}: could not change the access of feed ${feedID}`}\n`);
    }
    done.push(`feed_${feedID}`);
  }
  const said: string = entry.kind === 'user'
    ? `${entry.name} granted read on ${done.join(' ')}`
    : entry.kind === 'group'
      ? `group ${entry.name} granted read on ${done.join(' ')}`
      : `${done.join(' ')} ${reads ? 'public' : 'private'}`;
  return envelope_ok(`${said}\n`, {
    kind: 'fs.acl',
    data: { usernames: entry.kind === 'user' ? [entry.name] : [], groups: entry.kind === 'group' ? [entry.name] : [], ...(entry.kind === 'other' ? { public: reads } : {}), targets: done },
  });
}

/**
 * Withdraws a user's or a group's grant on feeds. A feed that held no such
 * grant is said, not passed over in silence.
 *
 * @param removal - The grant.
 * @param feedIDs - The feeds.
 * @returns An envelope naming what was withdrawn.
 */
async function acl_remove(removal: AclRemoval, feedIDs: number[]): Promise<CommandEnvelope> {
  const lines: string[] = [];
  const removed: string[] = [];
  for (const feedID of feedIDs) {
    const outcome: Result<boolean> = await feedShare_revoke(feedID, removal.kind, removal.name);
    if (!outcome.ok) {
      const error: StackMessage | undefined = errorStack.stack_pop();
      return envelope_error(`${error?.message ?? `setfacl: could not withdraw ${removal.kind} ${removal.name} from feed ${feedID}`}\n`);
    }
    if (outcome.value) removed.push(`feed_${feedID}`);
    else lines.push(`setfacl: feed_${feedID}: no entry for ${removal.kind} ${removal.name}`);
  }
  if (removed.length > 0) lines.unshift(`${removal.kind} ${removal.name} no longer reads ${removed.join(' ')}`);
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'fs.acl.removed', data: { kind: removal.kind, name: removal.name, targets: removed } });
}

/**
 * `chmod o+r` / `o-r` on feeds: the other entry, public or private, as
 * `setfacl -m o::r` / `o::-` writes it. No other mode is one a feed has.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope naming what changed.
 */
export async function builtin_chmod(args: string[]): Promise<CommandEnvelope> {
  const parsed = chmodArgs_parse(args);
  if (typeof parsed === 'string') return envelope_error(`${parsed}\n`);
  const feedIDs: number[] = [];
  for (const path of parsed.paths) {
    const feedID: number | null = aclTarget_resolve(path);
    if (feedID === null) return envelope_error(`chmod: '${path}' does not name a feed\n`);
    feedIDs.push(feedID);
  }
  return acl_apply(parsed.entry, feedIDs, 'chmod');
}

/**
 * Whether an invocation names paths but no entry to apply to them.
 *
 * @param args - Raw argument tokens.
 * @returns True when there is something to share and nobody to share with.
 */
function entryless_is(args: string[]): boolean {
  const flagged: boolean = args.some(
    (token: string): boolean => token === '-m' || token === '-x' || token.startsWith('--'),
  );
  const paths: string[] = args.filter((token: string): boolean => !token.startsWith('-'));
  return !flagged && paths.length >= 1;
}

/**
 * Asks which identity a feed should be shared with.
 *
 * @param feedIDs - The distinct feeds the grant is for, named in the question.
 * @returns The answer, empty when the operator abandoned it.
 */
async function who_ask(feedIDs: number[]): Promise<string> {
  const { repl_question } = await import('../../core/question.js');
  const named: string = feedIDs.length === 1
    ? `feed ${feedIDs[0]}`
    : `${feedIDs.length} feeds (${feedIDs.map((id: number): string => `feed_${id}`).join(', ')})`;
  try {
    // A grant is withdrawn by `setfacl -x`, so the question says only what
    // it asks.
    return await repl_question(`Share ${named} with which user? `);
  } catch {
    return '';
  }
}

/**
 * Reports a feed's access list, in `getfacl`'s own shape.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope carrying the rendered list.
 */
export async function builtin_getfacl(args: string[]): Promise<CommandEnvelope> {
  const paths: string[] = args.filter((token: string): boolean => !token.startsWith('-'));
  if (paths.length === 0) return envelope_error(`${GETFACL_USAGE}\n`);

  const blocks: string[] = [];
  const model: Array<{ path: string; usernames: string[]; groups: string[]; public: boolean }> = [];
  for (const path of paths) {
    const feedID: number | null = aclTarget_resolve(path);
    if (feedID === null) {
      return envelope_error(`getfacl: '${path}' does not name a feed\n`);
    }
    const held: Result<FeedAccess> = await feedAccess_read(feedID);
    if (!held.ok) {
      const error: StackMessage | undefined = errorStack.stack_pop();
      return envelope_error(`${error?.message ?? `getfacl: could not read the access list of feed ${feedID}`}\n`);
    }
    blocks.push(acl_render(path, null, held.value));
    model.push({ path, usernames: held.value.users, groups: held.value.groups, public: held.value.public });
  }

  return envelope_ok(`${blocks.join('\n\n')}\n`, { kind: 'fs.acl', data: model });
}
