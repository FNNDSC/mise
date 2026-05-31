/**
 * @file Static VFS Content Handler.
 *
 * Implements specialized virtual file reading and content generation
 * for static command directories (/bin, /usr/bin).
 *
 * @module
 */

import { Result, Ok, Err, errorStack, pipeline_resolve, PipelineRecord } from '@fnndsc/cumin';
import { commandHelp_get } from '../../../builtins/help.js';
import { pipeline_sourceGet } from '@fnndsc/salsa';
import chalk from 'chalk';
import { session } from '../../../session/index.js';

/**
 * Interface representing a ChRIS API Plugin parameter resource.
 */
interface ChRISApiPluginParameter {
  data: {
    name: string;
    type: string;
    optional: boolean;
    default?: string | number | boolean | null;
    help?: string;
  };
}

/**
 * Interface representing a ChRIS API Plugin resource.
 */
interface ChRISApiPlugin {
  data: {
    id: number;
    name: string;
    version: string;
    type: string;
    authors?: string;
    description?: string;
    documentation?: string;
    creation_date?: string;
  };
  getPluginParameters(options?: { limit?: number }): Promise<{ getItems(): ChRISApiPluginParameter[] }>;
}

/**
 * Formats a plugin parameter list into a beautifully aligned text manual.
 *
 * @param plugin - The resolved ChRIS plugin object.
 * @param parameters - Array of plugin parameters.
 * @param command - The exact plugin command/filename.
 * @returns Formatted details string.
 */
function pluginParameters_render(
  plugin: ChRISApiPlugin,
  parameters: ChRISApiPluginParameter[],
  command: string
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold.magenta(`${plugin.data.name.toUpperCase()} (Version ${plugin.data.version})`));
  lines.push(chalk.gray('─'.repeat(74)));
  lines.push(`${chalk.bold.blue('Type:')}         ${plugin.data.type || 'ds'}`);
  lines.push(`${chalk.bold.blue('Author:')}       ${plugin.data.authors || 'FNNDSC <dev@babymri.org>'}`);
  if (plugin.data.documentation) {
    lines.push(`${chalk.bold.blue('Repository:')}   ${plugin.data.documentation}`);
  }
  lines.push('');

  lines.push(chalk.bold.blue('DESCRIPTION'));
  lines.push(`  ${plugin.data.description || 'No description provided.'}`);
  lines.push('');

  lines.push(chalk.bold.blue('PARAMETERS'));
  lines.push(`  ${chalk.bold.white('Flag'.padEnd(22))}${chalk.bold.white('Type'.padEnd(11))}${chalk.bold.white('Required'.padEnd(11))}${chalk.bold.white('Default'.padEnd(13))}${chalk.bold.white('Description')}`);
  lines.push(`  ${chalk.gray('─'.repeat(74))}`);

  parameters.forEach((param: ChRISApiPluginParameter) => {
    const flag = `--${param.data.name}`;
    const type = param.data.type || 'string';
    const required = param.data.optional ? 'No' : 'Yes';
    
    let defaultValue = '';
    if (param.data.default !== undefined && param.data.default !== null) {
      defaultValue = String(param.data.default);
      if (defaultValue === '') {
        defaultValue = '""';
      }
    } else {
      defaultValue = 'None';
    }

    const help = param.data.help || '';
    lines.push(`  ${chalk.yellow(flag.padEnd(22))}${type.padEnd(11)}${required.padEnd(11)}${defaultValue.padEnd(13)}${help}`);
  });
  lines.push('');

  lines.push(chalk.bold.blue('USAGE EXAMPLES'));
  const requiredParams: ChRISApiPluginParameter[] = parameters.filter((p: ChRISApiPluginParameter) => !p.data.optional);
  const optionalParams: ChRISApiPluginParameter[] = parameters.filter((p: ChRISApiPluginParameter) => p.data.optional);
  const requiredFlags: string = requiredParams.map((p: ChRISApiPluginParameter) => `--${p.data.name} "value"`).join(' ');
  const basicExample: string = requiredFlags ? `${command} ${requiredFlags}` : command;
  lines.push(`  ${chalk.white(basicExample)}                     ${chalk.gray('# Basic execution')}`);
  if (optionalParams.length > 0) {
    const exampleParam: string = optionalParams[0].data.name;
    const withOptional: string = requiredFlags
      ? `${command} ${requiredFlags} --${exampleParam} "value"`
      : `${command} --${exampleParam} "value"`;
    lines.push(`  ${chalk.white(withOptional)}     ${chalk.gray('# With optional parameter')}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Renders a brief info block for a pipeline that has no registered YAML source.
 *
 * @param pipeline - The resolved PipelineRecord.
 * @returns Formatted summary string.
 */
function pipelineSummary_render(pipeline: PipelineRecord): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold.magenta(pipeline.name));
  lines.push(chalk.gray('─'.repeat(74)));
  lines.push(`${chalk.bold.blue('ID:')}       ${pipeline.id}`);
  if (pipeline.authors) lines.push(`${chalk.bold.blue('Authors:')}  ${pipeline.authors}`);
  if (pipeline.category) lines.push(`${chalk.bold.blue('Category:')} ${pipeline.category}`);
  if (pipeline.locked !== undefined) lines.push(`${chalk.bold.blue('Locked:')}   ${pipeline.locked}`);
  if (pipeline.description) {
    lines.push('');
    lines.push(chalk.bold.blue('DESCRIPTION'));
    lines.push(`  ${pipeline.description}`);
  }
  lines.push('');
  lines.push(chalk.dim('No YAML source registered. Use `pipeline info <name>` for full DAG details.'));
  lines.push('');
  return lines.join('\n');
}

/**
 * Reads virtual file content under command and builtin static paths.
 *
 * Handles help text formatting for /usr/bin and fetches parameter specifications for /bin plugins.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param prefix - The prefix of the calling provider (e.g. '/usr/bin', '/bin').
 * @returns Promise resolving to a Result containing the file contents as a string.
 */
export async function staticVfs_read(pathStr: string, prefix: string): Promise<Result<string>> {
  try {
    let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
      effectivePath = effectivePath.slice(0, -1);
    }

    if (prefix === "/usr/bin") {
      const commandName: string = effectivePath.substring("/usr/bin/".length);
      const helpStr = commandHelp_get(commandName);
      if (helpStr !== undefined) {
        return Ok(helpStr);
      }
      errorStack.stack_push("error", `No help available for command: ${commandName}`);
      return Err();
    }

    if (prefix === "/bin") {
      const commandName: string = effectivePath.substring("/bin/".length);
      const versionSeparatorIndex: number = commandName.lastIndexOf('-v');

      if (versionSeparatorIndex === -1) {
        const yamlResult = await pipeline_sourceGet(commandName);
        if (yamlResult.ok) return Ok(yamlResult.value);

        const resolveResult = await pipeline_resolve(commandName);
        if (resolveResult.ok) return Ok(pipelineSummary_render(resolveResult.value));

        errorStack.stack_push("error", `Unknown /bin entry: ${commandName}`);
        return Err();
      }

      const name: string = commandName.substring(0, versionSeparatorIndex);
      const version: string = commandName.substring(versionSeparatorIndex + 2);

      const client = await session.connection.client_get();
      if (!client) {
        errorStack.stack_push("error", "No active ChRIS connection to fetch plugin parameter specs");
        return Err();
      }

      const pluginsList = await client.getPlugins({ name_exact: name, version: version, limit: 1 });
      const plugins = pluginsList.getItems();
      if (!plugins || plugins.length === 0) {
        errorStack.stack_push("error", `Plugin not found on server: ${name} v${version}`);
        return Err();
      }

      const plugin = plugins[0] as unknown as ChRISApiPlugin;
      const parametersList = await plugin.getPluginParameters({ limit: 100 });
      const parameters = parametersList.getItems();

      const output: string = pluginParameters_render(plugin, parameters, commandName);
      return Ok(output);
    }

    errorStack.stack_push("error", `File not found: ${pathStr}`);
    return Err();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Static VFS read failed for prefix ${prefix}: ${msg}`);
    return Err();
  }
}

/**
 * Reads virtual file binary content under command and builtin static paths.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param prefix - The prefix of the calling provider.
 * @returns Promise resolving to a Result containing the file contents as a Buffer.
 */
export async function staticVfs_readBinary(pathStr: string, prefix: string): Promise<Result<Buffer>> {
  const res = await staticVfs_read(pathStr, prefix);
  if (res.ok) {
    return Ok(Buffer.from(res.value, "utf-8"));
  }
  return Err();
}
