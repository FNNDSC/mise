/**
 * @file Builtin feed command.
 * Manages feeds (list, create).
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
import { chiliCommand_run } from '../../chell.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { Result } from '@fnndsc/cumin';

/**
 * Handles feed commands.
 *
 * @param args - command arguments.
 */
export async function builtin_feed(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: feed <list|create> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { feeds, selectedFields, totalCount }: FeedListResult = await feeds_fetchList(parsed as unknown as CLIoptions);
       console.log(feedList_render(feeds, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
       if (totalCount !== undefined && feeds.length < totalCount) {
         console.log(chalk.dim(`  ↓ showing ${feeds.length} of ${totalCount}  ·  --all to fetch all  ·  --limit <n> for page size`));
       }
    } else if (subcommand === 'create') {
       const feed: Feed | null = await feed_create(parsed as unknown as CLIoptions);
       if (feed) {
          console.log(feedCreate_render(feed));
       }
    } else if (subcommand === 'inspect') {
       const fields: string[] | null = await feedFields_fetch();
       if (fields && fields.length > 0) {
         table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Feed fields', justification: 'center' } });
       } else {
         console.log(chalk.gray('No fields found.'));
       }
    } else if (subcommand === 'search') {
       const query: string = parsed._[1] ?? '';
       await builtin_feed(['list', '--search', query]);

    } else if (subcommand === 'note') {
       const second: string = String(parsed._[1] ?? '');

       // feed note edit <feedId>
       if (second === 'edit') {
         const feedId: number = parseInt(String(parsed._[2]), 10);
         if (isNaN(feedId)) { console.error(chalk.red('Usage: feed note edit <feedId>')); return; }
         const getResult: Result<FeedNote> = await feed_noteGet(feedId);
         if (!getResult.ok) { process.exitCode = 1; console.error(chalk.red(`Failed to get note for feed ${feedId}.`)); return; }
         const note: FeedNote = getResult.value;
         const tmpPath: string = join(tmpdir(), `chell-note-${feedId}-${Date.now()}.txt`);
         const body: string = `# Title: ${note.title}\n\n${note.content}`;
         writeFileSync(tmpPath, body, 'utf8');
         const editor: string = process.env.EDITOR || process.env.VISUAL || 'vi';
         spawnSync(editor, [tmpPath], { stdio: 'inherit' });
         const edited: string = readFileSync(tmpPath, 'utf8');
         if (existsSync(tmpPath)) try { unlinkSync(tmpPath); } catch { /* ignore */ }
         if (edited === body) { console.log(chalk.gray('(no changes)')); return; }
         const titleMatch: RegExpMatchArray | null = edited.match(/^#\s*Title:\s*(.+)/m);
         const title: string = titleMatch ? titleMatch[1].trim() : note.title;
         const content: string = edited.replace(/^#\s*Title:.*\n?/m, '').replace(/^\n+/, '');
         const updateResult: Result<boolean> = await feed_noteUpdate(feedId, { title, content });
         if (updateResult.ok) console.log(chalk.green(`Note updated on feed ${feedId}.`));
         else { process.exitCode = 1; console.error(chalk.red('Failed to save note.')); }
         return;
       }

       const feedId: number = parseInt(second, 10);
       if (isNaN(feedId)) { console.error(chalk.red('Usage: feed note <feedId> [--title <t>] [--content <c>]  |  feed note edit <feedId>')); return; }
       const hasUpdate: boolean = !!(parsed.title || parsed.content);
       if (hasUpdate) {
         const result: Result<boolean> = await feed_noteUpdate(feedId, {
           title: parsed.title as string | undefined,
           content: parsed.content as string | undefined,
         });
         if (result.ok) console.log(chalk.green(`Note updated on feed ${feedId}.`));
         else { process.exitCode = 1; console.error(chalk.red('Failed to update note.')); }
       } else {
         const result: Result<FeedNote> = await feed_noteGet(feedId);
         if (result.ok) console.log(feedNote_render(result.value, feedId));
         else { process.exitCode = 1; console.error(chalk.red(`Failed to get note for feed ${feedId}.`)); }
       }

    } else if (subcommand === 'comments') {
       const feedId: number = parseInt(String(parsed._[1]), 10);
       if (isNaN(feedId)) { console.error(chalk.red('Usage: feed comments <feedId>')); return; }
       const result: Result<FeedComment[]> = await feed_commentsList(feedId);
       if (result.ok) console.log(feedComments_render(result.value, feedId));
       else { process.exitCode = 1; console.error(chalk.red(`Failed to list comments for feed ${feedId}.`)); }

    } else if (subcommand === 'comment') {
       const op: string = parsed._[1] ?? '';
       const feedId: number = parseInt(String(parsed._[2]), 10);
       if (!op || isNaN(feedId)) {
         console.error(chalk.red('Usage: feed comment <add|delete|edit> <feedId> [commentId] [--title <t>] [--content <c>]'));
         return;
       }
       if (op === 'add') {
         const result: Result<FeedComment> = await feed_commentCreate(feedId, {
           title: parsed.title as string | undefined,
           content: parsed.content as string | undefined,
         });
         if (result.ok) console.log(chalk.green(`Comment added (id: ${result.value.id}) on feed ${feedId}.`));
         else { process.exitCode = 1; console.error(chalk.red('Failed to add comment.')); }
       } else if (op === 'delete') {
         const commentId: number = parseInt(String(parsed._[3]), 10);
         if (isNaN(commentId)) { console.error(chalk.red('Usage: feed comment delete <feedId> <commentId>')); return; }
         const result: Result<boolean> = await feed_commentDelete(feedId, commentId);
         if (result.ok) console.log(chalk.green(`Comment ${commentId} deleted.`));
         else { process.exitCode = 1; console.error(chalk.red('Failed to delete comment.')); }
       } else if (op === 'edit') {
         const commentId: number = parseInt(String(parsed._[3]), 10);
         if (isNaN(commentId)) { console.error(chalk.red('Usage: feed comment edit <feedId> <commentId> [--title <t>] [--content <c>]')); return; }
         const result: Result<boolean> = await feed_commentUpdate(feedId, commentId, {
           title: parsed.title as string | undefined,
           content: parsed.content as string | undefined,
         });
         if (result.ok) console.log(chalk.green(`Comment ${commentId} updated.`));
         else { process.exitCode = 1; console.error(chalk.red('Failed to update comment.')); }
       } else {
         console.error(chalk.red(`Unknown comment op: ${op}. Use add, delete, or edit.`));
         process.exitCode = 1;
       }

    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('feeds', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Feed error: ${msg}`));
  }
}
