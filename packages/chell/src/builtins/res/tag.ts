/**
 * @file Builtin tag command.
 *
 * Subcommands: list, search, inspect
 * Singular/plural aliases: tag / tags
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { tags_fetchList, TagListResult } from '@fnndsc/chili/commands/tags/list.js';
import { tagFields_fetch } from '@fnndsc/chili/commands/tags/fields.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

export async function builtin_tag(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { tags, selectedFields, totalCount }: TagListResult = await tags_fetchList(parsed as unknown as CLIoptions);
      if (tags.length === 0) { console.log(chalk.gray('No tags found.')); return; }
      table_display(tags, selectedFields, { title: { title: 'Tags', justification: 'center' }, pagination: totalCount !== undefined ? { shown: tags.length, total: totalCount } : undefined });
    } catch (e: unknown) {
      process.exitCode = 1;
      console.error(chalk.red(`tag error: ${e instanceof Error ? e.message : String(e)}`));
    }
    return;
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    await builtin_tag([...args.filter((a: string) => a !== subcommand), `--search`, query]);
    return;
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await tagFields_fetch();
    if (fields && fields.length > 0) {
      table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Tag fields', justification: 'center' } });
    } else {
      console.log(chalk.gray('No fields found for tags.'));
    }
    return;
  }

  process.exitCode = 1;
  console.log(chalk.red(`Unknown subcommand: ${subcommand}. Usage: tags <list|search|inspect>`));
}
