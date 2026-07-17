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
import { plugin_add, PluginAddOutcome } from '@fnndsc/chili/commands/plugins/add.js';
import { pluginList_render, pluginRun_render } from '@fnndsc/chili/views/plugin.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import { PluginInstance } from '@fnndsc/chili/models/plugin.js';
import { spinner } from '../../lib/spinner.js';
import { errorStack, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { adminPrompt_register } from '@fnndsc/chili/utils/admin_prompt.js';
import { chili_capture, type ChiliCaptured } from '@fnndsc/chili/screen/output.js';
import { repl_question, repl_questionHidden } from '../../core/question.js';

/**
 * Mutable result populated while Chili output is captured.
 *
 * @property outcome - Registration result returned by Chili.
 */
interface PluginAddCapture {
  outcome: PluginAddOutcome;
}

/**
 * Handles plugin commands.
 *
 * @param args - command arguments.
 * @returns An envelope carrying the rendered plugin output.
 */
export async function builtin_plugin(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string = parsed._[0];

  if (!subcommand) {
     return envelope_ok(`${chalk.red("Usage: plugin <list|run|add> ...")}\n`);
  }

  try {
    if (subcommand === 'list') {
       const { plugins, selectedFields, totalCount } = await plugins_fetchList(parsed as unknown as CLIoptions);
       let rendered: string = `${pluginList_render(plugins, selectedFields, { table: !!parsed.table, csv: !!parsed.csv })}\n`;
       if (totalCount !== undefined && plugins.length < totalCount) {
         rendered += `${chalk.dim(`  ↓ showing ${plugins.length} of ${totalCount}  ·  --all to fetch all  ·  --limit <n> for page size`)}\n`;
       }
       return envelope_ok(rendered);
    } else if (subcommand === 'run') {
       const searchable: string = parsed._[1];
       if (!searchable) {
          return envelope_ok(`${chalk.red("Usage: plugin run <plugin> [args...]")}\n`);
       }
       const params: string = args.slice(2).join(' ');
       const instance: PluginInstance | null = await plugin_execute(searchable, params);
       if (instance) {
          return envelope_ok(`${pluginRun_render(instance)}\n`);
       }
       process.exitCode = 1;
       return envelope_error('', undefined, `${chalk.red("Plugin execution failed.")}\n`);
    } else if (subcommand === 'add') {
       return await plugin_addInteractive(parsed);
    } else if (subcommand === 'inspect') {
       const fields: string[] | null = await pluginFields_fetch();
       if (fields && fields.length > 0) {
         return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Plugin fields', justification: 'center' } }));
       }
       return envelope_ok(`${chalk.gray('No fields found.')}\n`);
    } else if (subcommand === 'search') {
       const query: string = parsed._[1] ?? '';
       return await builtin_plugin(['list', `--search`, query]);
    }
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.yellow(`Unknown subcommand: ${subcommand}. Usage: plugin <list|run|add|inspect|search>`)}\n`);
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Plugin error: ${msg}`)}\n`);
  }
}

/**
 * Interactive plugin add command with spinner and colored output.
 *
 * @param parsed - Parsed command arguments.
 * @returns An envelope carrying the add outcome. The spinner streams live via
 *   the status channel; the result summary is carried in the envelope.
 */
export async function plugin_addInteractive(parsed: ParsedArgs): Promise<CommandEnvelope> {
  const pluginInput: string = parsed._[1];

  if (!pluginInput) {
    return envelope_ok(`${chalk.red('Usage: plugin add <name|image|url> [--compute <resources>] [--store <url>]')}\n`);
  }

  const options = {
    compute: parsed.compute as string | undefined,
    store: parsed.store as string | undefined,
    adminUser: parsed.adminUser as string | undefined,
    adminPassword: parsed.adminPassword as string | undefined,
    public_repo: parsed.publicRepo as string | undefined,
  };

  errorStack.stack_clear();
  adminPrompt_register(repl_question, repl_questionHidden);

  let rendered: string = `${chalk.cyan(`\nAdding plugin: ${pluginInput}\n`)}\n`;

  const result: PluginAddCapture = { outcome: 'failed' };
  const captured: ChiliCaptured = await chili_capture(async (): Promise<void> => {
    result.outcome = await plugin_add(pluginInput, options);
  });
  rendered += captured.out;
  rendered += captured.err;

  spinner.stop();

  if (result.outcome === 'installed') {
    rendered += `${chalk.green('\n[SUCCESS] Plugin added successfully!\n')}\n`;
    return envelope_ok(rendered);
  } else if (result.outcome === 'already_exists') {
    rendered += `${chalk.yellow(`\n[INFO] '${pluginInput}' is already registered in this CUBE.\n`)}\n`;
    return envelope_ok(rendered);
  }

  process.exitCode = 1;
  rendered += `${chalk.red('\n[FAILED] Failed to add plugin.\n')}\n`;

  const errors: string[] = errorStack.allOfType_get('error');
  if (errors.length > 0) {
    rendered += `${chalk.red('Errors:')}\n`;
    errors.forEach((error: string) => {
      const cleanError: string = error.replace(/^\[.*?\]\s+\|\s+/, '');
      rendered += `${chalk.red(`  - ${cleanError}`)}\n`;
    });
    rendered += '\n';
  }

  const warnings: string[] = errorStack.allOfType_get('warning');
  if (warnings.length > 0) {
    rendered += `${chalk.yellow('Warnings:')}\n`;
    warnings.forEach((warning: string) => {
      const cleanWarning: string = warning.replace(/^\[.*?\]\s+\|\s+/, '');
      rendered += `${chalk.yellow(`  [WARNING] ${cleanWarning}`)}\n`;
    });
    rendered += '\n';
  }

  return envelope_ok(rendered);
}
