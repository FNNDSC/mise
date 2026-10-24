/**
 * @file Builtin tag command.
 *
 * Subcommands: list, search, inspect
 * Singular/plural aliases: tag / tags
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs, cliOptions_extract, resourceListOptions_refusal, resourceSearchTerm_refusal, resourceSearch_args } from '../utils.js';
import { tags_fetchList, TagListResult } from '@fnndsc/chili/commands/tags/list.js';
import { tagFields_fetch } from '@fnndsc/chili/commands/tags/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/**
 * Builtin handler for the `tag` command.
 *
 * @param args - Parsed command arguments for the tag command.
 * @returns An envelope carrying the tag listing or fields.
 */
export async function builtin_tag(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    const refusal: string | null = resourceListOptions_refusal('tag', parsed);
    if (refusal !== null) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(refusal)}\n`);
    }
    try {
      const { tags, selectedFields, totalCount }: TagListResult = await tags_fetchList(cliOptions_extract(parsed));
      if (tags.length === 0) { return envelope_ok(`${chalk.gray('No tags found.')}\n`); }
      return envelope_ok(table_render(tags, selectedFields, { title: { title: 'Tags', justification: 'center' }, pagination: totalCount !== undefined ? { shown: tags.length, total: totalCount } : undefined }));
    } catch (e: unknown) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`tag error: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    }
  }

  if (subcommand === 'search') {
    const refusal: string | null = resourceSearchTerm_refusal('tag', parsed);
    if (refusal !== null) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(refusal)}\n`);
    }
    return builtin_tag(resourceSearch_args(parsed));
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await tagFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Tag fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for tags.')}\n`);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: tags <list|search|inspect>`)}\n`);
}
