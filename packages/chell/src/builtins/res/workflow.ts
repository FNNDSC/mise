/**
 * @file Builtin workflow command.
 *
 * Subcommands: list, search, inspect
 * Aliases: workflow / workflows
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { workflows_fetchList, WorkflowListResult } from '@fnndsc/chili/commands/workflows/list.js';
import { workflowFields_fetch } from '@fnndsc/chili/commands/workflows/fields.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

export async function builtin_workflow(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { workflows, selectedFields, totalCount }: WorkflowListResult = await workflows_fetchList(parsed as unknown as CLIoptions);
      if (workflows.length === 0) { console.log(chalk.gray('No workflows found.')); return; }
      table_display(workflows, selectedFields, { title: { title: 'Workflows', justification: 'center' }, pagination: totalCount !== undefined ? { shown: workflows.length, total: totalCount } : undefined });
    } catch (e: unknown) {
      process.exitCode = 1;
      console.error(chalk.red(`workflow error: ${e instanceof Error ? e.message : String(e)}`));
    }
    return;
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    await builtin_workflow([...args.filter((a: string) => a !== subcommand), `--search`, query]);
    return;
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await workflowFields_fetch();
    if (fields && fields.length > 0) {
      table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Workflow fields', justification: 'center' } });
    } else {
      console.log(chalk.gray('No fields found for workflows.'));
    }
    return;
  }

  process.exitCode = 1;
  console.log(chalk.red(`Unknown subcommand: ${subcommand}. Usage: workflows <list|search|inspect>`));
}
