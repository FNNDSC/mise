/**
 * @file Builtin plugin/plugins command.
 *
 * Handles plugin management in chell. Subcommands:
 * - `list`  — fetch and render the plugin collection via chili
 * - `run`   — execute a plugin instance by searchable name/id
 * - `add`   — register a new plugin into CUBE (interactive, with spinner)
 *
 * Unknown subcommands fall through to a spawned chili process.
 * `plugin` and `plugins` are both registered as aliases in COMMAND_HANDLERS.
 *
 * @module
 */
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { plugins_fetchList } from '@fnndsc/chili/commands/plugins/list.js';
import { pluginFields_fetch } from '@fnndsc/chili/commands/plugins/fields.js';
import { plugin_execute } from '@fnndsc/chili/commands/plugin/run.js';
import { plugin_add } from '@fnndsc/chili/commands/plugins/add.js';
import { pluginList_render, pluginRun_render } from '@fnndsc/chili/views/plugin.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { PluginInstance } from '@fnndsc/chili/models/plugin.js';
import { chiliCommand_run } from '../../chell.js';
import { spinner } from '../../lib/spinner.js';
import { errorStack } from '@fnndsc/cumin';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Handles plugin commands.
 *
 * @param args - command arguments.
 */
export async function builtin_plugin(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];

  if (!subcommand) {
     console.log(chalk.red("Usage: plugin <list|run|add> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { plugins, selectedFields } = await plugins_fetchList(parsed as unknown as CLIoptions);
       console.log(pluginList_render(plugins, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
    } else if (subcommand === 'run') {
       const searchable = parsed._[1];
       if (!searchable) {
          console.log(chalk.red("Usage: plugin run <plugin> [args...]"));
          return;
       }
       const params = args.slice(2).join(' ');
       const instance: PluginInstance | null = await plugin_execute(searchable, params);
       if (instance) {
          console.log(pluginRun_render(instance));
       } else {
          console.error(chalk.red("Plugin execution failed."));
       }
    } else if (subcommand === 'add') {
       await plugin_addInteractive(parsed);
    } else if (subcommand === 'inspect') {
       const fields: string[] | null = await pluginFields_fetch();
       if (fields && fields.length > 0) {
         table_display(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Plugin fields', justification: 'center' } });
       } else {
         console.log(chalk.gray('No fields found.'));
       }
    } else if (subcommand === 'search') {
       const query: string = parsed._[1] ?? '';
       await builtin_plugin(['list', `--search`, query]);
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('plugins', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Plugin error: ${msg}`));
  }
}

/**
 * Interactive plugin add command with spinner and colored output.
 *
 * @param parsed - Parsed command arguments.
 */
export async function plugin_addInteractive(parsed: ParsedArgs): Promise<void> {
  const pluginInput = parsed._[1];

  if (!pluginInput) {
    console.log(chalk.red('Usage: plugin add <name|image|url> [--compute <resources>] [--store <url>]'));
    return;
  }

  const options = {
    compute: parsed.compute as string | undefined,
    store: parsed.store as string | undefined,
    adminUser: parsed.adminUser as string | undefined,
    adminPassword: parsed.adminPassword as string | undefined,
    public_repo: parsed.publicRepo as string | undefined,
  };

  errorStack.stack_clear();

  console.log(chalk.cyan(`\nAdding plugin: ${pluginInput}\n`));

  const success = await plugin_add(pluginInput, options);

  spinner.stop();

  if (success) {
    console.log(chalk.green('\n[SUCCESS] Plugin added successfully!\n'));
  } else {
    process.exitCode = 1;
    console.log(chalk.red('\n[FAILED] Failed to add plugin.\n'));

    const errors = errorStack.allOfType_get('error');
    if (errors.length > 0) {
      console.log(chalk.red('Errors:'));
      errors.forEach((error: string) => {
        // Remove function name prefix for cleaner display
        const cleanError = error.replace(/^\[.*?\]\s+\|\s+/, '');
        console.log(chalk.red(`  - ${cleanError}`));
      });
      console.log('');
    }

    const warnings = errorStack.allOfType_get('warning');
    if (warnings.length > 0) {
      console.log(chalk.yellow('Warnings:'));
      warnings.forEach((warning: string) => {
        const cleanWarning = warning.replace(/^\[.*?\]\s+\|\s+/, '');
        console.log(chalk.yellow(`  [WARNING] ${cleanWarning}`));
      });
      console.log('');
    }
  }
}
