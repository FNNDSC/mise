/**
 * @file Implements the logic for retrieving a ChRIS plugin's README.
 *
 * This module provides functionality to fetch the README content
 * for a specific plugin by its ID.
 *
 * @module
 */
import { plugin_readme as salsaPlugin_readme } from "@fnndsc/salsa";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import chalk from "chalk";

marked.setOptions({
  renderer: new TerminalRenderer({
    code:           chalk.yellow,
    blockquote:     chalk.gray.italic,
    html:           chalk.gray,
    heading:        chalk.green.bold,
    firstHeading:   chalk.magenta.underline.bold,
    hr:             chalk.reset,
    listitem:       chalk.cyan,
    table:          chalk.white,
    paragraph:      chalk.white,
    strong:         chalk.bold,
    em:             chalk.italic,
    codespan:       chalk.yellow,
    del:            chalk.dim.gray.strikethrough,
    link:           chalk.cyan,
    href:           chalk.blueBright.underline,
  }),
});

/**
 * Fetches the raw README content for a plugin.
 *
 * @param pluginId - The ID of the plugin.
 * @returns A Promise resolving to the README content as a string, or `null` if not available.
 */
export async function pluginReadme_fetch(pluginId: string): Promise<string | null> {
  return await salsaPlugin_readme(pluginId);
}

/**
 * Renders raw README markdown/rst content for terminal display.
 *
 * @param content - Raw README string.
 * @returns ANSI-styled string ready for console output.
 */
export function pluginReadme_render(content: string): string {
  return marked(content) as string;
}
