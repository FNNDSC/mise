/**
 * @file Builtin files command (and links, dirs).
 * Manages file resources.
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { files_fetchList } from '@fnndsc/chili/commands/files/list.js';
import { fileFields_fetch } from '@fnndsc/chili/commands/files/fields.js';
import { FilteredResourceData, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Generic handler for file group commands (files, links, dirs).
 *
 * @param args - command arguments.
 * @param assetName - the asset type ('files', 'links', 'dirs').
 * @returns An envelope carrying the listing or fields.
 */
async function builtin_fileGroup(args: string[], assetName: string): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string = parsed._[0];

  if (!subcommand) {
     return envelope_ok(`${chalk.red(`Usage: ${assetName} <list|search|inspect> ...`)}\n`);
  }

  try {
    if (subcommand === 'list') {
       const path: string | undefined = parsed._[1] as string | undefined;
       const results: FilteredResourceData | null = await files_fetchList(parsed as unknown as CLIoptions, assetName, path);

       if (!results) {
          return envelope_error('', undefined, `No ${assetName} resources found. Perhaps check your current context?\n`);
       }

       if (results.tableData.length === 0) {
          return envelope_ok(`No ${assetName} found matching the criteria.\n`);
       }
       return envelope_ok(table_render(
          results.tableData,
          results.selectedFields,
          {
            title: { title: assetName, justification: "center" },
            pagination: results.totalCount !== undefined ? { shown: results.tableData.length, total: results.totalCount } : undefined,
          }
       ));
    } else if (subcommand === 'search') {
       const query: string = (parsed._[1] as string | undefined) ?? '';
       return builtin_fileGroup([...args.filter((a: string) => a !== subcommand), '--search', query], assetName);
    } else if (subcommand === 'inspect' || subcommand === 'fieldslist') {
       const fields: string[] | null = await fileFields_fetch(assetName);
       if (fields && fields.length > 0) {
          return envelope_ok(table_render(fields.map(f => ({ fields: f })), ["fields"]));
       }
       return envelope_ok(`No resource fields found for ${assetName}.\n`);
    }
    process.exitCode = 1;
    return envelope_error(`${chalk.yellow(`Unknown subcommand: ${subcommand}. Usage: ${assetName} <list|search|inspect>`)}\n`);
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`${assetName} error: ${msg}`)}\n`);
  }
}

/**
 * Handles files commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the files listing or fields.
 */
export async function builtin_files(args: string[]): Promise<CommandEnvelope> {
  return builtin_fileGroup(args, 'files');
}

/**
 * Handles links commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the links listing or fields.
 */
export async function builtin_links(args: string[]): Promise<CommandEnvelope> {
  return builtin_fileGroup(args, 'links');
}

/**
 * Handles dirs commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the dirs listing or fields.
 */
export async function builtin_dirs(args: string[]): Promise<CommandEnvelope> {
  return builtin_fileGroup(args, 'dirs');
}
