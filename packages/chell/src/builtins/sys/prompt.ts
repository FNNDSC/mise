/**
 * @file Builtin prompt command.
 *
 * Lists available prompt themes, switches the active theme, or configures
 * optional segments for the current theme.
 *
 * @module
 */
import chalk from 'chalk';
import { settings, settings_save } from '../../config/settings.js';
import { THEME_NAMES, P10K_OPTIONAL_SEGMENTS, prompt_render, type ThemeName, type P10kSegmentConfig, type PromptContext } from '../../core/prompt/index.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext } from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { repl_question } from '../../core/question.js';
import { promptContext_build, segmentTokens_parse } from './prompt.helpers.js';

/** All segments in display order, with metadata. */
interface SegmentMeta {
  label: string;
  description: string;
  toggleable: boolean;
}

const ALL_SEGMENTS: SegmentMeta[] = [
  { label: 'host',     description: 'CUBE host URL',                                                toggleable: false },
  { label: 'pacs',     description: 'Active PACS server (set via: context set PACSserver <id>)',     toggleable: true  },
  { label: 'user',     description: 'Logged-in username',                                           toggleable: false },
  { label: 'dir',      description: 'Current VFS path',                                             toggleable: false },
  { label: 'time',     description: 'Current time (HH:MM)',                                         toggleable: true  },
  { label: 'duration', description: 'Last command duration — shown when ≥ 3s',                      toggleable: true  },
  { label: 'status',   description: 'Last exit code — shown when non-zero',                         toggleable: true  },
];

/**
 * Prints the configure menu for the current theme.
 *
 * @param pacsserver - Current PACS server from context, or null if unset.
 */
function configure_print(pacsserver: string | null): void {
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
  console.log(`  ${chalk.gray('─'.repeat(66))}`);

  for (const seg of ALL_SEGMENTS) {
    let enabled: boolean;
    if (seg.toggleable) {
      const val: boolean = settings.config.p10kSegments[seg.label as keyof P10kSegmentConfig];
      // pacs: ON only when both toggled on AND a server is actually set
      enabled = seg.label === 'pacs' ? (val && pacsserver !== null) : val;
    } else {
      enabled = true;
    }

    const statusStr: string = enabled ? chalk.green('[ON ] ') : chalk.gray('[OFF] ');
    const toggleHint: string = !seg.toggleable ? chalk.gray(' (always)') : '';
    console.log(`  ${chalk.cyan(seg.label.padEnd(12))}${statusStr}${seg.description}${toggleHint}`);
  }

  console.log(chalk.gray('\n  Toggle optional segments: prompt toggle <segment>'));
  console.log('');
}

/**
 * Renders and prints the current prompt once (useful for single-shot testing).
 */
async function promptShow_handle(): Promise<void> {
  const context: SingleContext = await context_getSingle();
  const cwd: string = await session.getCWD();
  const ctx: PromptContext = promptContext_build(
    context,
    cwd,
    session.offline,
    session.physicalMode_get(),
    process.stdout.columns || 80,
    settings.config.p10kSegments
  );
  process.stdout.write(prompt_render(settings.config.promptTheme, ctx) + '\n');
}

/**
 * Runs the interactive p10k segment configurator.
 */
async function promptConfigure_handle(): Promise<void> {
  const theme: ThemeName = settings.config.promptTheme;
  if (theme !== 'p10k') {
    console.log(chalk.yellow(`No configurable segments for '${theme}' theme.`));
    console.log(chalk.gray(`Switch to p10k first: prompt p10k`));
    return;
  }

  const ctxForConfigure: SingleContext = await context_getSingle();
  const pacsserver: string | null = ctxForConfigure.pacsserver ?? null;

  configure_print(pacsserver);
  const answer: string = await repl_question(
    chalk.white('Enter segment names to toggle (e.g. "time duration"), or Enter to exit: ')
  );

  if (!answer) return;

  const tokens: string[] = segmentTokens_parse(answer);
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
    configure_print(pacsserver);
  }
}

/**
 * Toggles a single p10k optional segment on/off.
 *
 * @param segName - The segment name to toggle.
 */
async function promptToggle_handle(segName: string | undefined): Promise<void> {
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
    await promptToggle_handle(args[1]);
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
    await promptShow_handle();
    return;
  }

  // --configure — interactive segment configurator (p10k only)
  if (hasConfigure) {
    await promptConfigure_handle();
  }
}
