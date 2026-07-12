/**
 * @file Builtin workflow command.
 *
 * Subcommands: list, search, inspect
 * Aliases: workflow / workflows
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { workflows_fetchList, WorkflowListResult } from '@fnndsc/chili/commands/workflows/list.js';
import { workflowFields_fetch } from '@fnndsc/chili/commands/workflows/fields.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Builtin handler for the `workflow` command.
 *
 * @param args - Parsed command arguments for the workflow command.
 */
export async function builtin_workflow(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { workflows, selectedFields, totalCount }: WorkflowListResult = await workflows_fetchList(parsed as unknown as CLIoptions);
      if (workflows.length === 0) { return envelope_ok(`${chalk.gray('No workflows found.')}\n`); }
      return envelope_ok(table_render(workflows, selectedFields, { title: { title: 'Workflows', justification: 'center' }, pagination: totalCount !== undefined ? { shown: workflows.length, total: totalCount } : undefined }));
    } catch (e: unknown) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`workflow error: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    }
  }

  if (subcommand === 'search') {
    const query: string = parsed._[1] ?? '';
    return builtin_workflow([...args.filter((a: string) => a !== subcommand), `--search`, query]);
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await workflowFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Workflow fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found for workflows.')}\n`);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: workflows <list|search|inspect>`)}\n`);
}
