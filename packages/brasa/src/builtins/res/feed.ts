/**
 * @file Builtin feed command.
 * Manages feeds (list, create, inspect, note, comments).
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { feeds_fetchList, FeedListResult } from '@fnndsc/chili/commands/feeds/list.js';
import { feedFields_fetch } from '@fnndsc/chili/commands/feeds/fields.js';
import { feed_create } from '@fnndsc/chili/commands/feed/create.js';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { feed_noteGet, feed_noteUpdate } from '@fnndsc/chili/commands/feed/note.js';
import type { FeedNote } from '@fnndsc/chili/commands/feed/note.js';
import { feed_commentsList, feed_commentCreate, feed_commentDelete, feed_commentUpdate } from '@fnndsc/chili/commands/feed/comments.js';
import type { FeedComment } from '@fnndsc/chili/commands/feed/comments.js';
import { feedList_render, feedCreate_render, feedNote_render, feedComments_render } from '@fnndsc/chili/views/feed.js';
import { Feed } from '@fnndsc/chili/models/feed.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { Result, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { noteEditBody_format, noteEditBody_parse } from './feed.notes.js';
import { feedTree_handle } from './feed.tree.js';
import { feedDiagram_handle } from './feed.diagram.js';

/**
 * Handles `feed list`: fetches and renders the feed table.
 *
 * @param parsed - The parsed command arguments.
 * @returns An envelope carrying the rendered feed table.
 */
async function feedList_handle(parsed: ParsedArgs): Promise<CommandEnvelope> {
  const { feeds, selectedFields, totalCount }: FeedListResult = await feeds_fetchList(parsed as unknown as CLIoptions);
  let rendered: string = `${feedList_render(feeds, selectedFields, { table: !!parsed.table, csv: !!parsed.csv })}\n`;
  if (totalCount !== undefined && feeds.length < totalCount) {
    rendered += `${chalk.dim(`  ↓ showing ${feeds.length} of ${totalCount}  ·  --all to fetch all  ·  --limit <n> for page size`)}\n`;
  }
  return envelope_ok(rendered);
}

/**
 * Handles `feed inspect`: lists the available feed fields.
 *
 * @returns An envelope carrying the field listing.
 */
async function feedInspect_handle(): Promise<CommandEnvelope> {
  const fields: string[] | null = await feedFields_fetch();
  if (fields && fields.length > 0) {
    return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Feed fields', justification: 'center' } }));
  }
  return envelope_ok(`${chalk.gray('No fields found.')}\n`);
}

/**
 * Edits a feed note interactively via `$EDITOR`.
 *
 * @param feedId - The feed whose note is edited.
 * @returns An envelope carrying the edit outcome.
 */
async function feedNote_edit(feedId: number): Promise<CommandEnvelope> {
  const getResult: Result<FeedNote> = await feed_noteGet(feedId);
  if (!getResult.ok) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Failed to get note for feed ${feedId}.`)}\n`);
  }
  const note: FeedNote = getResult.value;
  const tmpPath: string = join(tmpdir(), `chell-note-${feedId}-${Date.now()}.txt`);
  const body: string = noteEditBody_format(note);
  writeFileSync(tmpPath, body, 'utf8');
  const editor: string = process.env.EDITOR || process.env.VISUAL || 'vi';
  spawnSync(editor, [tmpPath], { stdio: 'inherit' });
  const edited: string = readFileSync(tmpPath, 'utf8');
  if (existsSync(tmpPath)) try { unlinkSync(tmpPath); } catch { /* ignore */ }
  if (edited === body) {
    return envelope_ok(`${chalk.gray('(no changes)')}\n`);
  }
  const { title, content } = noteEditBody_parse(edited, note.title);
  const updateResult: Result<boolean> = await feed_noteUpdate(feedId, { title, content });
  if (updateResult.ok) return envelope_ok(`${chalk.green(`Note updated on feed ${feedId}.`)}\n`);
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red('Failed to save note.')}\n`);
}

/**
 * Handles `feed note ...`: interactive edit, direct update, or display.
 *
 * @param parsed - The parsed command arguments.
 * @returns An envelope carrying the note or update outcome.
 */
async function feedNote_handle(parsed: ParsedArgs): Promise<CommandEnvelope> {
  const second: string = String(parsed._[1] ?? '');

  if (second === 'edit') {
    const feedId: number = parseInt(String(parsed._[2]), 10);
    if (isNaN(feedId)) { return envelope_error('', undefined, `${chalk.red('Usage: feed note edit <feedId>')}\n`); }
    return feedNote_edit(feedId);
  }

  const feedId: number = parseInt(second, 10);
  if (isNaN(feedId)) {
    return envelope_error('', undefined, `${chalk.red('Usage: feed note <feedId> [--title <t>] [--content <c>]  |  feed note edit <feedId>')}\n`);
  }
  const hasUpdate: boolean = !!(parsed.title || parsed.content);
  if (hasUpdate) {
    const result: Result<boolean> = await feed_noteUpdate(feedId, {
      title: parsed.title as string | undefined,
      content: parsed.content as string | undefined,
    });
    if (result.ok) return envelope_ok(`${chalk.green(`Note updated on feed ${feedId}.`)}\n`);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Failed to update note.')}\n`);
  }
  const result: Result<FeedNote> = await feed_noteGet(feedId);
  if (result.ok) return envelope_ok(`${feedNote_render(result.value, feedId)}\n`);
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(`Failed to get note for feed ${feedId}.`)}\n`);
}

/**
 * Handles `feed comment <add|delete|edit> ...`.
 *
 * @param parsed - The parsed command arguments.
 * @returns An envelope carrying the comment operation outcome.
 */
async function feedComment_handle(parsed: ParsedArgs): Promise<CommandEnvelope> {
  const op: string = parsed._[1] ?? '';
  const feedId: number = parseInt(String(parsed._[2]), 10);
  if (!op || isNaN(feedId)) {
    return envelope_error('', undefined, `${chalk.red('Usage: feed comment <add|delete|edit> <feedId> [commentId] [--title <t>] [--content <c>]')}\n`);
  }
  if (op === 'add') {
    const result: Result<FeedComment> = await feed_commentCreate(feedId, {
      title: parsed.title as string | undefined,
      content: parsed.content as string | undefined,
    });
    if (result.ok) return envelope_ok(`${chalk.green(`Comment added (id: ${result.value.id}) on feed ${feedId}.`)}\n`);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Failed to add comment.')}\n`);
  } else if (op === 'delete') {
    const commentId: number = parseInt(String(parsed._[3]), 10);
    if (isNaN(commentId)) { return envelope_error('', undefined, `${chalk.red('Usage: feed comment delete <feedId> <commentId>')}\n`); }
    const result: Result<boolean> = await feed_commentDelete(feedId, commentId);
    if (result.ok) return envelope_ok(`${chalk.green(`Comment ${commentId} deleted.`)}\n`);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Failed to delete comment.')}\n`);
  } else if (op === 'edit') {
    const commentId: number = parseInt(String(parsed._[3]), 10);
    if (isNaN(commentId)) { return envelope_error('', undefined, `${chalk.red('Usage: feed comment edit <feedId> <commentId> [--title <t>] [--content <c>]')}\n`); }
    const result: Result<boolean> = await feed_commentUpdate(feedId, commentId, {
      title: parsed.title as string | undefined,
      content: parsed.content as string | undefined,
    });
    if (result.ok) return envelope_ok(`${chalk.green(`Comment ${commentId} updated.`)}\n`);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Failed to update comment.')}\n`);
  }
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(`Unknown comment op: ${op}. Use add, delete, or edit.`)}\n`);
}

/**
 * Handles feed commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the rendered feed output.
 */
export async function builtin_feed(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand) {
    return envelope_ok(`${chalk.red("Usage: feed <list|create|inspect|search|note|comments|comment|tree> ...")}\n`);
  }

  try {
    if (subcommand === 'list') {
      return await feedList_handle(parsed);
    } else if (subcommand === 'create') {
      const feed: Feed | null = await feed_create(parsed as unknown as CLIoptions);
      return envelope_ok(feed ? `${feedCreate_render(feed)}\n` : '');
    } else if (subcommand === 'inspect') {
      return await feedInspect_handle();
    } else if (subcommand === 'search') {
      const query: string = parsed._[1] ?? '';
      return await builtin_feed(['list', '--search', query]);
    } else if (subcommand === 'note') {
      return await feedNote_handle(parsed);
    } else if (subcommand === 'comments') {
      const feedId: number = parseInt(String(parsed._[1]), 10);
      if (isNaN(feedId)) { return envelope_error('', undefined, `${chalk.red('Usage: feed comments <feedId>')}\n`); }
      const result: Result<FeedComment[]> = await feed_commentsList(feedId);
      if (result.ok) return envelope_ok(`${feedComments_render(result.value, feedId)}\n`);
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`Failed to list comments for feed ${feedId}.`)}\n`);
    } else if (subcommand === 'comment') {
      return await feedComment_handle(parsed);
    } else if (subcommand === 'tree') {
      const feedId: number = parseInt(String(parsed._[1]), 10);
      if (isNaN(feedId)) { return envelope_error('', undefined, `${chalk.red('Usage: feed tree <feedId> [--focus <id>] [--max-nodes <n>]')}\n`); }
      const focusRaw: string | undefined = parsed.focus as string | undefined;
      const focusId: number | undefined = focusRaw !== undefined ? parseInt(String(focusRaw), 10) : undefined;
      const maxRaw: string | undefined = parsed['max-nodes'] as string | undefined;
      const maxNodes: number = maxRaw !== undefined ? parseInt(String(maxRaw), 10) : 0;
      return await feedTree_handle(feedId, focusId, isNaN(maxNodes) ? 0 : maxNodes, !!parsed.flat);
    } else if (subcommand === 'diagram') {
      const feedId: number = parseInt(String(parsed._[1]), 10);
      if (isNaN(feedId)) { return envelope_error('', undefined, `${chalk.red('Usage: feed diagram <feedId> [--svg] [--out <path>] [--stdout]')}\n`); }
      const out: string | undefined = parsed.out as string | undefined;
      return await feedDiagram_handle(feedId, { svg: !!parsed.svg, toStdout: !!parsed.stdout, out });
    }
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Unknown subcommand: ${subcommand}. Usage: feed <list|create|inspect|search|note|comments|comment|tree|diagram>`)}\n`);
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Feed error: ${msg}`)}\n`);
  }
}
