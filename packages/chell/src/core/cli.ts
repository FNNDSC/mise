/**
 * @file CLI Parser
 *
 * Extracts the logic for parsing command line arguments for `chell`.
 * This allows testing the argument parsing logic without side effects.
 *
 * @module
 */
import { Command, type Help } from 'commander';
import { existsSync } from 'fs';
import chalk from 'chalk';

/**
 * Parsed chell CLI configuration.
 */
export interface ChellCLIConfig {
  mode: 'interactive' | 'connect' | 'help' | 'version' | 'execute' | 'script';
  physicalFS?: boolean;
  prefetchPlugins?: boolean;
  prefetchFeeds?: boolean;
  prefetchPublicFeeds?: boolean;
  prefetchJobs?: boolean;
  asciiBoot?: boolean;
  showLogo?: boolean;
  commandToExecute?: string;
  scriptFile?: string;
  stopOnError?: boolean;
  connectConfig?: {
    user?: string;
    password?: string;
    url?: string;
  };
  output?: string; // For help/version text
}

/**
 * Options accepted by the chell CLI action handler.
 */
export interface CliActionOptions {
  user?: string;
  password?: string;
  command?: string;
  file?: string;
  e?: boolean;
  physicalFS?: boolean;
  prefetchFeeds?: boolean;
  prefetchPublicFeeds?: boolean;
  prefetchPlugins?: boolean;
  prefetchJobs?: boolean;
  asciiBoot?: boolean;
  logo?: boolean;
}

/**
 * Builds a {@link ChellCLIConfig} from the parsed target/options, determining
 * the run mode (script/execute/connect/interactive) and applying startup
 * preference toggles.
 *
 * @param target - The positional target argument (user@url, url, or script path).
 * @param options - The parsed CLI options.
 * @param fileExists - Predicate testing whether a path exists (for script auto-detect).
 * @returns The resolved configuration.
 */
export function cliConfig_fromArgs(
  target: string | undefined,
  options: CliActionOptions,
  fileExists: (path: string) => boolean
): ChellCLIConfig {
  let user: string | undefined = options.user;
  let url: string | undefined = target;
  const password: string | undefined = options.password;
  let connectConfig: { user?: string; password?: string; url?: string } | undefined;

  if (url && url.includes('@')) {
    const parts: string[] = url.split('@');
    user = parts[0];
    url = parts[1];
  }

  if (url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    connectConfig = { user, password, url };
  }

  let config: ChellCLIConfig;
  if (options.file) {
    config = { mode: 'script', scriptFile: options.file, stopOnError: options.e || false, physicalFS: options.physicalFS, connectConfig };
  } else if (options.command) {
    config = { mode: 'execute', commandToExecute: options.command, stopOnError: options.e || false, physicalFS: options.physicalFS, connectConfig };
  } else if (target && fileExists(target)) {
    // Auto-detect script file: if target exists as a file, treat as script
    config = { mode: 'script', scriptFile: target, stopOnError: options.e || false, physicalFS: options.physicalFS };
  } else if (connectConfig) {
    config = { mode: 'connect', physicalFS: options.physicalFS, connectConfig };
  } else {
    config = { mode: 'interactive', physicalFS: options.physicalFS };
  }

  // Apply startup preference toggles when provided
  if (typeof options.prefetchFeeds === 'boolean') config.prefetchFeeds = options.prefetchFeeds;
  if (typeof options.prefetchPublicFeeds === 'boolean') config.prefetchPublicFeeds = options.prefetchPublicFeeds;
  if (typeof options.prefetchPlugins === 'boolean') config.prefetchPlugins = options.prefetchPlugins;
  if (typeof options.prefetchJobs === 'boolean') config.prefetchJobs = options.prefetchJobs;
  if (typeof options.asciiBoot === 'boolean') config.asciiBoot = options.asciiBoot;
  if (typeof options.logo === 'boolean') config.showLogo = options.logo;

  return config;
}

/**
 * Custom man-page-style help formatter for the chell program.
 *
 * @param cmd - The command being rendered.
 * @param helper - Commander's help helper.
 * @returns The formatted help string.
 */
function chellHelp_format(cmd: Command, helper: Help): string {
  const termWidth: number = helper.padWidth(cmd, helper);
  const helpWidth: number = helper.helpWidth || 80;
  const itemIndentWidth: number = 2;
  const itemSeparatorWidth: number = 2; // between term and description

  const item_format = (term: string, description: string): string => {
    if (description) {
      const fullText: string = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
      return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
    }
    return term;
  };

  const list_format = (textArray: string[]): string =>
    textArray.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth));

  // Usage
  let output: string[] = [`${chalk.bold.cyan('USAGE')}\n  ${helper.commandUsage(cmd)}`, ''];

  // Description
  const commandDescription: string = helper.commandDescription(cmd);
  if (commandDescription.length > 0) {
    output = output.concat(['  ' + helper.wrap(commandDescription, helpWidth - 2, 0).replace(/\n/g, '\n  '), '']);
  }

  // Arguments
  const argumentList: string[] = helper.visibleArguments(cmd).map((argument) =>
    item_format(helper.argumentTerm(argument), helper.argumentDescription(argument)),
  );
  if (argumentList.length > 0) {
    output = output.concat([chalk.bold.cyan('ARGUMENTS'), list_format(argumentList), '']);
  }

  // Options
  const optionList: string[] = helper.visibleOptions(cmd).map((option) =>
    item_format(helper.optionTerm(option), helper.optionDescription(option)),
  );
  if (optionList.length > 0) {
    output = output.concat([chalk.bold.cyan('OPTIONS'), list_format(optionList), '']);
  }

  return output.join('\n');
}

/**
 * Builds the configured commander program (name, version, help text, and
 * options) for chell, without an action handler attached.
 *
 * @param version - The package version string.
 * @returns The configured commander Command.
 */
function cliProgram_build(version: string): Command {
  const program: Command = new Command();
  program
    .name('chell')
    .version(version)
    .description('ChRIS Interactive Shell (ChELL) - A powerful, terminal-based virtual file system (VFS) and interactive REPL for ChRIS.')
    .addHelpText('before', `
${chalk.bold.cyan('NAME')}
    ${chalk.bold('chell')} - ChRIS Interactive Shell (ChELL Executes Layered Logic)

${chalk.bold.cyan('DESCRIPTION')}
    ${chalk.bold('ChELL')} is a terminal-based interface and Virtual File System (VFS)
    router for the ChRIS medical image processing platform. It bridges the gap
    between complex web APIs and terminal muscle-memory.

    It maps remote ChRIS CUBE resources to an intuitive local folder experience:
      - Feeds, pipelines, and files are structured as navigable directories.
      - Registered CUBE plugins are mapped as executable binaries inside ${chalk.yellow('/bin')}.
      - Standard utilities (${chalk.green('cd')}, ${chalk.green('ls')}, ${chalk.green('pwd')}, ${chalk.green('cat')}) run directly on remote storage.

    Whether navigating data or running pipelines, ChELL leverages your current
    working directory as execution context, letting you run containerized medical
    image analyses using command-line muscle-memory.
      `)
    .argument('[target]', 'Target CUBE (user@url or url)')
    .option('-u, --user <user>', 'Username')
    .option('-p, --password <password>', 'Password')
    .option('-c, --command <command>', 'Execute command(s) and exit (use ; to separate multiple commands)')
    .option('-f, --file <path>', 'Execute commands from script file')
    .option('-e', 'Stop on first error (like bash set -e). Default: continue on error')
    .option('--physicalFS', 'Use physical filesystem paths (skip logical-to-physical mapping)')
    .option('--prefetch-feeds', 'Prefetch user feeds at startup (interactive mode)')
    .option('--no-prefetch-feeds', 'Disable feed prefetch at startup')
    .option('--prefetch-public-feeds', 'Prefetch public feeds at startup (interactive mode)')
    .option('--no-prefetch-plugins', 'Skip plugin cache prefetch at startup')
    .option('--no-prefetch-jobs', 'Skip /proc/jobs job cache prefetch at startup')
    .option('--ascii-boot', 'Force ASCII-only boot UI (no box-drawing characters)')
    .option('--no-logo', 'Hide the ChRIS logo on startup (interactive mode)')
    .addHelpText('after', `
${chalk.bold.cyan('INTERACTIVE COMMANDS')}
  ${chalk.bold.green('connect')}     Connect to a ChRIS CUBE
  ${chalk.bold.green('logout')}      Log out from the current CUBE session
  ${chalk.bold.green('cd')}          Change the current virtual directory
  ${chalk.bold.green('ls')}          List virtual directory contents
  ${chalk.bold.green('pwd')}         Print the current virtual working directory
  ${chalk.bold.green('cat')}         Display file contents
  ${chalk.bold.green('exit')}        Exit the interactive shell
  ${chalk.bold.yellow('<other>')}     Any unrecognized command is passed directly to the chili CLI

${chalk.bold.cyan('SHELL FEATURES')}
  ${chalk.bold('Pipes')}              Chain command stdout: ${chalk.dim('cat file.txt | wc -l')}
  ${chalk.bold('Output Redirection')} Write/append to virtual files: ${chalk.dim('ls -lh > output.txt')}
  ${chalk.bold('Semicolons')}         Run sequentially: ${chalk.dim('cd /tmp; ls; pwd')}
  ${chalk.bold('Shell Escape')}       Run host OS commands inside the REPL with ${chalk.bold.green('!')} prefix

${chalk.bold.cyan('AUTOMATION & SCRIPTING')}
  ${chalk.bold('Shebang Support')}     Prepend ${chalk.yellow('#!/usr/bin/env chell')} to make scripts executable
  ${chalk.bold('Comments')}            Lines beginning with ${chalk.bold('#')} are ignored
  ${chalk.bold('Error Handling')}      Default: continue on error. Use ${chalk.bold.green('-e')} to stop on first failure

${chalk.bold.cyan('EXAMPLES')}
  ${chalk.bold('chell')} ${chalk.bold.green('-c')} ${chalk.yellow('"ls /PIPELINES"')}                           # Execute single command and exit
  ${chalk.bold('chell')} ${chalk.bold.green('-c')} ${chalk.yellow('"cd /PIPELINES; ls; cat main.yml"')}     # Sequential CLI command pipeline
  ${chalk.bold('chell')} ${chalk.yellow('script.chell')}                                 # Run script file (auto-detect)
  ${chalk.bold('chell')} ${chalk.bold.green('-e')} ${chalk.yellow('script.chell')}                               # Run script file, stopping on first error
  ${chalk.bold('./script.chell')}                                     # Execute direct script via shebang
      `)
    .configureHelp({ formatHelp: chellHelp_format });
  return program;
}

/**
 * Parses command line arguments and extracts configuration for the Chell interactive shell.
 *
 * @param argv - The command line arguments (typically process.argv).
 * @param version - The version string of the package.
 * @returns A Promise resolving to a ChellCLIConfig containing the parsed parameters.
 */
export function cli_parse(argv: string[], version: string): Promise<ChellCLIConfig> {
  return new Promise((resolve) => {
    const program: Command = cliProgram_build(version);
    let config: ChellCLIConfig = { mode: 'interactive' };
    let capturedOutput: string = '';

    program
      .action((target: string | undefined, options: CliActionOptions) => {
        config = cliConfig_fromArgs(target, options, existsSync);
      });

    // Capture help/version output instead of writing to stdout
    program.configureOutput({
      writeOut: (str: string) => {
        capturedOutput += str;
        config = { mode: 'help', output: capturedOutput };
      },
      writeErr: (str: string) => {
        capturedOutput += str;
        config = { mode: 'help', output: capturedOutput };
      },
      outputError: (str: string) => {
        capturedOutput += str;
        config = { mode: 'help', output: capturedOutput };
      }
    });
    
    // We need to handle exit events to prevent process.exit() during tests
    program.exitOverride((err: Error & { code?: string }) => {
        if (err.code === 'commander.helpDisplayed') {
            resolve({ mode: 'help', output: capturedOutput || program.helpInformation() });
        } else if (err.code === 'commander.version') {
            resolve({ mode: 'version', output: version });
        } else {
            // For other errors (e.g. missing arg), we might want to reject or return help
            resolve({ mode: 'help', output: err.message });
        }
        // We return a promise that never resolves here to stop execution flow in main? 
        // No, in `cli_parse` we resolve.
        throw err; // Rethrow to be caught by parseAsync catch block
    });

    program.parseAsync(argv)
      .then(() => {
          resolve(config);
      })
      .catch((err: Error & { code?: string }) => {
          // If exitOverride threw, we handled it above mostly?
          // Actually exitOverride throws.
          if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
             resolve(config);
          } else {
             // Real error
             // For now, treat as help/error output
             resolve({ mode: 'help', output: err.message });
          }
      });
  });
}
