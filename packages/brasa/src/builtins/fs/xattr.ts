/**
 * @file `setfattr` and `getfattr` — a feed's tags.
 *
 * CUBE's freeform tags on a feed are, in POSIX terms, the values of one
 * extended attribute, `tag`. The capability lives in the kernel
 * (`feedTags_list`, `feedTag_add`, `feedTag_remove`); this is its shell face.
 *
 * @module
 */
import {
  CommandEnvelope, envelope_ok, envelope_error, errorStack,
  feedTags_list, feedTag_add, feedTag_remove, type FeedTag, type Result, type StackMessage,
} from '@fnndsc/cumin';
import {
  getfattrArgs_parse, setfattrArgs_parse, xattrTarget_resolve, xattr_render,
  type GetfattrArgs, type SetfattrArgs,
} from './xattr.args.js';
import { error_stripDebugPrefix } from '../utils.js';

/**
 * A refusal, on a line of its own.
 *
 * @param message - What was refused, and why.
 * @returns The error envelope.
 */
function refusal(message: string): CommandEnvelope {
  return envelope_error(`${message}\n`);
}

/**
 * The kernel's last word, or a fallback.
 *
 * @param fallback - What to say when the kernel said nothing.
 * @returns The message.
 */
function error_said(fallback: string): string {
  const error: StackMessage | undefined = errorStack.stack_pop();
  return error?.message ?? fallback;
}

/**
 * Reads the tags a feed wears, in `getfattr`'s dump shape.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope carrying the rendered blocks and a model of them.
 */
export async function builtin_getfattr(args: string[]): Promise<CommandEnvelope> {
  const parsed: GetfattrArgs = getfattrArgs_parse(args);
  if (parsed.error !== null) return refusal(parsed.error);
  const blocks: string[] = [];
  const model: Array<{ path: string; feedId: number; tags: string[] }> = [];
  for (const path of parsed.paths) {
    const feedId: number | null = xattrTarget_resolve(path);
    if (feedId === null) return refusal(`getfattr: '${path}' does not name a feed`);
    const held: Result<FeedTag[]> = await feedTags_list(feedId);
    if (!held.ok) return refusal(error_said(`getfattr: could not read the tags of feed ${feedId}`));
    const tags: string[] = held.value.map((tag: FeedTag): string => tag.name);
    blocks.push(xattr_render(path, tags));
    model.push({ path, feedId, tags });
  }
  return envelope_ok(`${blocks.join('\n\n')}\n`, { kind: 'fs.xattr', data: model });
}

/**
 * Hangs a tag on feeds (`-n tag -v <value>`), or takes one off (`-x tag -v
 * <value>`), or takes every tag off (`-x tag`, as setfattr removes the
 * whole attribute). Silent on success, as setfattr is; a refusal is named.
 *
 * @param args - Raw argument tokens.
 * @returns An envelope, empty on success.
 */
export async function builtin_setfattr(args: string[]): Promise<CommandEnvelope> {
  const parsed: SetfattrArgs = setfattrArgs_parse(args);
  if (parsed.error !== null) return refusal(parsed.error);
  const changed: Array<{ feedId: number; tag: string; done: boolean }> = [];
  for (const path of parsed.paths) {
    const feedId: number | null = xattrTarget_resolve(path);
    if (feedId === null) return refusal(`setfattr: '${path}' does not name a feed`);
    let names: string[];
    if (parsed.mode === 'remove' && parsed.value === null) {
      const held: Result<FeedTag[]> = await feedTags_list(feedId);
      if (!held.ok) return refusal(error_said(`setfattr: could not read the tags of feed ${feedId}`));
      names = held.value.map((tag: FeedTag): string => tag.name);
    } else {
      names = [parsed.value ?? ''];
    }
    for (const name of names) {
      const done: Result<boolean> = parsed.mode === 'set' ? await feedTag_add(feedId, name) : await feedTag_remove(feedId, name);
      if (!done.ok) {
        const said: string = error_stripDebugPrefix(error_said(`could not ${parsed.mode === 'set' ? 'add' : 'remove'} tag ${name}`));
        return refusal(`setfattr: ${path}: ${said}`);
      }
      if (parsed.mode === 'remove' && parsed.value !== null && !done.value) {
        return refusal(`setfattr: ${path}: tag="${name}": No such attribute value`);
      }
      changed.push({ feedId, tag: name, done: done.value });
    }
  }
  return envelope_ok('', { kind: 'fs.xattr.changed', data: { mode: parsed.mode, changed } });
}
