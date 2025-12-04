/**
 * @file Builtin files command (and links, dirs).
 * Manages file resources.
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { files_fetchList } from '@fnndsc/chili/commands/files/list.js';
import { fileFields_fetch } from '@fnndsc/chili/commands/files/fields.js';
import { FilteredResourceData, errorStack } from '@fnndsc/cumin';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { chiliCommand_run } from '../../chell.js';

/**
 * Generic handler for file group commands (files, links, dirs).
 *
 * @param args - command arguments.
 * @param assetName - the asset type ('files', 'links', 'dirs').
 */
async function builtin_fileGroup(args: string[], assetName: string): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];

  if (!subcommand) {
     console.log(chalk.red(`Usage: ${assetName} <list|fieldslist|delete|share> ...`));
     return;
  }

  try {
    if (subcommand === 'list') {
       const path = parsed._[1] as string | undefined;
       const results: FilteredResourceData | null = await files_fetchList(parsed as any, assetName, path);

       if (!results) {
          console.error(`No ${assetName} resources found. Perhaps check your current context?`);
          return;
       }

       if (results.tableData.length === 0) {
          console.log(`No ${assetName} found matching the criteria.`);
       } else {
          table_display(
             results.tableData,
             results.selectedFields,
             { title: { title: assetName, justification: "center" } }
          );
       }
    } else if (subcommand === 'fieldslist') {
       const fields: string[] | null = await fileFields_fetch(assetName);
       if (fields && fields.length > 0) {
          table_display(fields.map(f => ({ fields: f })), ["fields"]);
       } else {
          console.log(`No resource fields found for ${assetName}.`);
       }
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run(assetName, ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`${assetName} error: ${msg}`));
  }
}

/**
 * Handles files commands.
 *
 * @param args - command arguments.
 */
export async function builtin_files(args: string[]): Promise<void> {
  await builtin_fileGroup(args, 'files');
}

/**
 * Handles links commands.
 *
 * @param args - command arguments.
 */
export async function builtin_links(args: string[]): Promise<void> {
  await builtin_fileGroup(args, 'links');
}

/**
 * Handles dirs commands.
 *
 * @param args - command arguments.
 */
export async function builtin_dirs(args: string[]): Promise<void> {
  await builtin_fileGroup(args, 'dirs');
}
