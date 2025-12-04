/**
 * @file Builtin context command.
 * Displays the current session context.
 */
import chalk from 'chalk';
import { context_getSingle } from '@fnndsc/salsa';
import { session } from '../../session/index.js';
import { SingleContext } from '@fnndsc/cumin';
import { table_display } from '@fnndsc/chili/screen/screen.js';

/**
 * Displays the current ChRIS context.
 *
 * @param args - Command line arguments (optional flags).
 */
export async function builtin_context(args: string[]): Promise<void> {
  const context: SingleContext = context_getSingle();

  const tableData = [
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
      Context: 'Physical Mode',
      Value: session.physicalMode_get() ? chalk.magenta('Enabled') : chalk.gray('Disabled'),
    },
  ];

  table_display(
    tableData,
    ['Context', 'Value'],
    {
      title: { title: 'ChRIS Context', justification: 'center' },
    }
  );
}
