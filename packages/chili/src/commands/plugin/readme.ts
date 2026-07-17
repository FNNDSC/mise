/**
 * @file Implements the logic for retrieving a ChRIS plugin's README.
 *
 * This module provides functionality to fetch the README content
 * for a specific plugin by its ID.
 *
 * @module
 */
import {
  pluginReadmeDocument_fetch as salsaPluginReadmeDocument_fetch,
  type PluginReadmeDocument,
} from "@fnndsc/salsa";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import chalk from "chalk";

marked.setOptions({
  // @ts-expect-error marked-terminal@6 ships .d.ts that drift from marked@9's
  // Renderer type at this runtime-compatible version pair. (Tracked: align the
  // marked / marked-terminal versions across chili & chell.)
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
 * @returns README content with format metadata, or `null` if not available.
 */
export async function pluginReadme_fetch(pluginId: string): Promise<PluginReadmeDocument | null> {
  return await salsaPluginReadmeDocument_fetch(pluginId);
}

/**
 * Renders raw README markdown/rst content for terminal display.
 *
 * reStructuredText is deliberately preserved: feeding it through a Markdown
 * parser corrupts its structure. Markdown receives terminal styling.
 *
 * @param document - Raw README and its source format.
 * @returns A terminal display string; Markdown is styled and RST is preserved.
 */
export function pluginReadme_render(document: PluginReadmeDocument): string {
  if (document.format === 'rst') {
    return document.content;
  }
  return marked(document.content) as string;
}
