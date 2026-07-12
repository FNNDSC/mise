/**
 * @file Builtin context command.
 * Displays the current session context.
 */
import chalk from 'chalk';
import { context_getSingle } from '@fnndsc/salsa';
import { session } from '../../session/index.js';
import { SingleContext, CommandEnvelope, envelope_ok } from '@fnndsc/cumin';
import { table_render } from '@fnndsc/chili/screen/screen.js';

/** A single context key/value row for tabular display. */
interface ContextRow {
  Context: string;
  Value: string;
  [key: string]: string;
}


/**
 * Displays the current ChRIS context.
 *
 * @param args - Command line arguments (optional flags).
 */
export async function builtin_context(_args: string[]): Promise<CommandEnvelope> {
  const context: SingleContext = await context_getSingle();

  const tableData: ContextRow[] = [
    {
      Context: 'ChRIS User',
      Value: context.user || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS URL',
      Value: context.URL || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS Folder',
      Value: context.folder || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS Feed',
      Value: context.feed || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS Plugin',
      Value: context.plugin || chalk.gray('Not set'),
    },
    {
      Context: 'PACS Server',
      Value: context.pacsserver || chalk.gray('Not set'),
    },
    {
      Context: 'Physical Mode',
      Value: session.physicalMode_get() ? chalk.magenta('Enabled') : chalk.gray('Disabled'),
    },
  ];

  return envelope_ok(
    table_render(tableData, ['Context', 'Value'], {
      title: { title: 'ChRIS Context', justification: 'center' },
    }),
  );
}
