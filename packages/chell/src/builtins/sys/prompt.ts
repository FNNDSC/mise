/**
 * @file Builtin prompt command.
 *
 * Lists available prompt themes, switches the active theme, or configures
 * optional segments for the current theme.
 *
 * @module
 */
import * as readline from 'readline';
import chalk from 'chalk';
import { settings, settings_save } from '../../config/settings.js';
import { THEME_NAMES, P10K_OPTIONAL_SEGMENTS, prompt_render, type ThemeName, type P10kSegmentConfig, type PromptContext } from '../../core/prompt/index.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext } from '@fnndsc/cumin';
import { session } from '../../session/index.js';

/** Human-readable descriptions for each optional p10k segment. */
const SEGMENT_DESCRIPTIONS: Record<keyof P10kSegmentConfig, string> = {
  time:     'Current time (HH:MM)',
  duration: 'Last command duration — shown when ≥ 3s',
  status:   'Last exit code — shown when non-zero',
};

/**
 * Asks a single question on stdout/stdin and resolves with the answer.
 *
 * @param prompt - The question to display.
 * @returns The trimmed answer string.
 */
function question_ask(prompt: string): Promise<string> {
  return new Promise((resolve: (answer: string) => void) => {
    const rl: readline.Interface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prints the configure menu for the current theme.
 */
function configure_print(): void {
  const theme: ThemeName = settings.config.promptTheme;

  if (theme !== 'p10k') {
    console.log(chalk.yellow(`No configurable segments for '${theme}' theme.`));
    console.log(chalk.gray(`Switch to p10k first: prompt p10k`));
    return;
  }

  console.log(chalk.bold.blue('\np10k segment configuration:\n'));
  console.log(
    `  ${chalk.bold('Segment'.padEnd(12))}${chalk.bold('Status'.padEnd(8))}${chalk.bold('Description')}`
  );
  console.log(`  ${chalk.gray('─'.repeat(58))}`);

  for (const key of P10K_OPTIONAL_SEGMENTS) {
    const enabled: boolean = settings.config.p10kSegments[key];
    const statusStr: string = enabled
      ? chalk.green('[ON ] ')
      : chalk.gray('[OFF] ');
    console.log(`  ${chalk.cyan(key.padEnd(12))}${statusStr}${SEGMENT_DESCRIPTIONS[key]}`);
  }

  console.log('');
}

/**
 * Lists available themes or switches/configures the active theme.
 *
 * Subcommands:
 *   prompt                  — show current theme
 *   prompt list             — list all themes
 *   prompt <theme>          — activate named theme
 *   prompt toggle <segment> — toggle a p10k segment on/off
 *   prompt --configure      — interactive segment configurator (p10k only)
 *
 * @param args - Command line arguments.
 */
export async function builtin_prompt(args: string[]): Promise<void> {
  const hasConfigure: boolean = args.includes('--configure');
  const hasShow: boolean = args.includes('--show');
  const subcommand: string | undefined = args[0];

  // No args — show current state
  if (!subcommand) {
    const current: ThemeName = settings.config.promptTheme;
    console.log(`Prompt theme: ${chalk.yellow(current)}`);
    console.log(chalk.gray(`  Available: ${THEME_NAMES.join(', ')}`));
    console.log(chalk.gray('\nUsage: prompt list | prompt <theme> | prompt toggle <segment> | prompt --configure'));
    return;
  }

  // list
  if (subcommand === 'list') {
    console.log(chalk.bold.blue('Available prompt themes:'));
    const current: ThemeName = settings.config.promptTheme;
    for (const name of THEME_NAMES) {
      const marker: string = name === current ? chalk.green(' ✓ (active)') : '';
      console.log(`  ${chalk.cyan(name)}${marker}`);
    }
    return;
  }

  // toggle <segment>
  if (subcommand === 'toggle') {
    const segName: string | undefined = args[1];
    const validKey: boolean = segName !== undefined &&
      (P10K_OPTIONAL_SEGMENTS as readonly string[]).includes(segName);

    if (!validKey) {
      console.log(chalk.red(`Usage: prompt toggle <segment>`));
      console.log(chalk.gray(`  Segments: ${P10K_OPTIONAL_SEGMENTS.join(', ')}`));
      return;
    }

    const key: keyof P10kSegmentConfig = segName as keyof P10kSegmentConfig;
    const prev: boolean = settings.config.p10kSegments[key];
    settings.config.p10kSegments[key] = !prev;
    await settings_save();
    const nowStr: string = settings.config.p10kSegments[key] ? chalk.green('ON') : chalk.gray('OFF');
    console.log(`  ${chalk.cyan(key)} → ${nowStr}`);
    return;
  }

  // Switch theme if a known theme name is present (may be combined with flags)
  if (subcommand && !subcommand.startsWith('--')) {
    const isKnown: boolean = (THEME_NAMES as readonly string[]).includes(subcommand);
    if (!isKnown) {
      console.log(chalk.red(`Unknown theme: '${subcommand}'`));
      console.log(chalk.gray(`  Available: ${THEME_NAMES.join(', ')}`));
      return;
    }
    const theme: ThemeName = subcommand as ThemeName;
    settings.config.promptTheme = theme;
    await settings_save();
    console.log(chalk.green(`[+] Prompt theme set to '${theme}'`));
    // fall through to handle any flags that followed
  }

  // --show — render and print the current prompt (useful for single-shot testing)
  if (hasShow) {
    const context: SingleContext = await context_getSingle();
    const cwd: string = await session.getCWD();
    const isOffline: boolean = session.offline;
    const ctx: PromptContext = {
      user:                  isOffline ? 'disconnected' : (context.user ?? 'disconnected'),
      uri:                   isOffline ? 'no-cube'      : (context.URL  ?? 'no-cube'),
      cwd:                   isOffline ? '/'            : cwd,
      pacsserver:            context.pacsserver ?? null,
      physicalMode:          session.physicalMode_get(),
      terminalWidth:         process.stdout.columns || 80,
      lastExitCode:          0,
      lastCommandDurationMs: 0,
      p10kSegments:          settings.config.p10kSegments,
    };
    process.stdout.write(prompt_render(settings.config.promptTheme, ctx) + '\n');
    return;
  }

  // --configure — interactive segment configurator (p10k only)
  if (hasConfigure) {
    const theme: ThemeName = settings.config.promptTheme;
    if (theme !== 'p10k') {
      console.log(chalk.yellow(`No configurable segments for '${theme}' theme.`));
      console.log(chalk.gray(`Switch to p10k first: prompt p10k`));
      return;
    }

    configure_print();
    const answer: string = await question_ask(
      chalk.white('Enter segment names to toggle (e.g. "time duration"), or Enter to exit: ')
    );

    if (!answer) return;

    const tokens: string[] = answer.split(/[\s,]+/).filter((t: string) => t.length > 0);
    const changed: string[] = [];

    for (const token of tokens) {
      if ((P10K_OPTIONAL_SEGMENTS as readonly string[]).includes(token)) {
        const key: keyof P10kSegmentConfig = token as keyof P10kSegmentConfig;
        settings.config.p10kSegments[key] = !settings.config.p10kSegments[key];
        changed.push(token);
      } else {
        console.log(chalk.yellow(`  Unknown segment: '${token}' — skipped`));
      }
    }

    if (changed.length > 0) {
      await settings_save();
      configure_print();
    }
  }
}
