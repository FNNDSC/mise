/**
 * @file Builtin prompt command.
 * Lists available prompt themes or switches the active theme.
 *
 * @module
 */
import chalk from 'chalk';
import { settings } from '../../config/settings.js';
import { THEME_NAMES, type ThemeName } from '../../core/prompt/index.js';

/**
 * Lists available themes or switches to a named theme.
 *
 * Subcommands:
 *   prompt list          — print all theme names
 *   prompt <name>        — activate the named theme
 *   prompt               — print current theme
 *
 * @param args - Command line arguments.
 */
export async function builtin_prompt(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    const current: ThemeName = settings.config.promptTheme;
    console.log(`Prompt theme: ${chalk.yellow(current)}`);
    console.log(chalk.gray(`  Available: ${THEME_NAMES.join(', ')}`));
    console.log(chalk.gray('\nUsage: prompt list | prompt <theme>'));
    return;
  }

  if (subcommand === 'list') {
    console.log(chalk.bold.blue('Available prompt themes:'));
    const current: ThemeName = settings.config.promptTheme;
    for (const name of THEME_NAMES) {
      const marker: string = name === current ? chalk.green(' ✓ (active)') : '';
      console.log(`  ${chalk.cyan(name)}${marker}`);
    }
    return;
  }

  const isKnown: boolean = (THEME_NAMES as readonly string[]).includes(subcommand);
  if (!isKnown) {
    console.log(chalk.red(`Unknown theme: '${subcommand}'`));
    console.log(chalk.gray(`  Available: ${THEME_NAMES.join(', ')}`));
    return;
  }

  const theme: ThemeName = subcommand as ThemeName;
  settings.config.promptTheme = theme;
  console.log(chalk.green(`[+] Prompt theme set to '${theme}'`));
}
