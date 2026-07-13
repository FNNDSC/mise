/**
 * @file Renderer for plugin parameter tables in man/help output.
 *
 * @module
 */

import chalk from 'chalk';
import { FilteredResourceData } from '@fnndsc/cumin';
import { chiliLog } from "../screen/output.js";

/**
 * Plugin parameter object structure.
 */
interface PluginParameter {
  name?: string;
  flag?: string;
  action?: string;
  type?: string;
  default?: string | number | boolean;
  help?: string;
  [key: string]: unknown;
}

/**
 * Renders plugin parameters in a "man page" style format.
 * 
 * Format:
 * [long parameter] [short parameter -- only if different] <value> (default: <default value>) 
 * Type: <type>
 * [help description]
 *
 * @param data - The filtered resource data containing plugin parameters.
 */
export function pluginParameters_renderMan(data: FilteredResourceData): void {
  chiliLog(pluginParameters_manRender(data));
}

/**
 * Builds the "man page" style rendering of plugin parameters as a string.
 *
 * Same format as {@link pluginParameters_renderMan} but returns the text
 * instead of printing it, so hosted surfaces can carry it in an envelope.
 *
 * @param data - The filtered resource data containing plugin parameters.
 * @returns The rendered parameter listing.
 */
export function pluginParameters_manRender(data: FilteredResourceData): string {
  if (!data.tableData || data.tableData.length === 0) {
    return "No parameters found.";
  }

  const lines: string[] = [];

  data.tableData.forEach((param: PluginParameter) => {
    // 1. Construct the first line: Flags and Value
    let line1Parts: string[] = [];

    // Long flag: Display only if name length > 1
    if (param.name && param.name.length > 1) {
      line1Parts.push(chalk.bold(`--${param.name}`));
    }

    // Short flag: Display only if it exists and is a single character (excluding dashes)
    // Note: 'param.flag' usually comes with dashes (e.g. '-v').
    if (param.flag) {
      const cleanFlag: string = param.flag.replace(/^-+/, '');
      if (cleanFlag.length === 1) {
        // Avoid duplicating if it somehow matches the long flag visual (unlikely given logic)
        // The prompt says "only if different to long parameter".
        // Since long parameter is always --name (length > 1) and this is -f (length 1),
        // they are visually different.
        line1Parts.push(chalk.bold(param.flag));
      }
    }

    // Value placeholder
    if (param.action === 'store_true' || param.action === 'store_false') {
      // Boolean flags usually don't take a value in the signature invocation
    } else {
      // Generic value placeholder based on type
      const valueType: string = param.type ? `<${param.type}>` : '<value>';
      line1Parts.push(chalk.cyan(valueType));
    }

    // Default value
    if (param.default !== undefined && param.default !== null && param.default !== "") {
      line1Parts.push(chalk.gray(`(default: ${param.default})`));
    }

    if (line1Parts.length > 0) {
      lines.push(line1Parts.join(' '));
    } else if (param.name) {
      // Fallback: if line1 is empty but we have a name, show it as a long flag
      // to avoid invisible params.
      lines.push(chalk.bold(`--${param.name}`) + ' ' + chalk.gray('(implicit)'));
    }

    // 2. Type line
    if (param.type) {
      lines.push(`Type: ${chalk.yellow(param.type)}`);
    }

    // 3. Help description
    if (param.help) {
      lines.push(chalk.white(param.help));
    }

    // Separator (blank line)
    lines.push('');
  });

  return lines.join('\n');
}
