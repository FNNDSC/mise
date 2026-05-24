/**
 * @file CLI Parser
 *
 * Extracts the logic for parsing command line arguments for `chell`.
 * This allows testing the argument parsing logic without side effects.
 *
 * @module
 */
import { Command } from 'commander';
import { existsSync } from 'fs';
import chalk from 'chalk';

export interface ChellCLIConfig {
  mode: 'interactive' | 'connect' | 'help' | 'version' | 'execute' | 'script';
  physicalFS?: boolean;
  prefetchPlugins?: boolean;
  prefetchFeeds?: boolean;
  prefetchPublicFeeds?: boolean;
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
 * Parses command line arguments and extracts configuration for the Chell interactive shell.
 *
 * @param argv - The command line arguments (typically process.argv).
 * @param version - The version string of the package.
 * @returns A Promise resolving to a ChellCLIConfig containing the parsed parameters.
 */
export function cli_parse(argv: string[], version: string): Promise<ChellCLIConfig> {
  return new Promise((resolve) => {
    const program: Command = new Command();
    let config: ChellCLIConfig = { mode: 'interactive' };
    let capturedOutput = '';

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
  ${chalk.bold.green('chefs')}       Access ChRIS Experimental File System controls
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
      .configureHelp({
        formatHelp: (cmd, helper) => {
          const termWidth = helper.padWidth(cmd, helper);
          const helpWidth = helper.helpWidth || 80;
          const itemIndentWidth = 2;
          const itemSeparatorWidth = 2; // between term and description
          
          function formatItem(term: string, description: string) {
            if (description) {
              const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
              return helper.wrap(
                fullText,
                helpWidth - itemIndentWidth,
                termWidth + itemSeparatorWidth,
              );
            }
            return term;
          }
          
          function formatList(textArray: string[]) {
            return textArray.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth));
          }

          // Usage
          let output: string[] = [`${chalk.bold.cyan('USAGE')}\n  ${helper.commandUsage(cmd)}`, ''];

          // Description
          const commandDescription = helper.commandDescription(cmd);
          if (commandDescription.length > 0) {
            output = output.concat([
              '  ' + helper.wrap(commandDescription, helpWidth - 2, 0).replace(/\n/g, '\n  '),
              '',
            ]);
          }

          // Arguments
          const argumentList = helper.visibleArguments(cmd).map((argument) => {
            return formatItem(
              helper.argumentTerm(argument),
              helper.argumentDescription(argument),
            );
          });
          if (argumentList.length > 0) {
            output = output.concat([chalk.bold.cyan('ARGUMENTS'), formatList(argumentList), '']);
          }

          // Options
          const optionList = helper.visibleOptions(cmd).map((option) => {
            return formatItem(
              helper.optionTerm(option),
              helper.optionDescription(option),
            );
          });
          if (optionList.length > 0) {
            output = output.concat([chalk.bold.cyan('OPTIONS'), formatList(optionList), '']);
          }

          return output.join('\n');
        }
      })
      .action((target: string | undefined, options: {
        user?: string;
        password?: string;
        command?: string;
        file?: string;
        e?: boolean;
        physicalFS?: boolean;
        prefetchFeeds?: boolean;
        prefetchPublicFeeds?: boolean;
        prefetchPlugins?: boolean;
        asciiBoot?: boolean;
        logo?: boolean;
      }) => {
          let user: string | undefined = options.user;
          let url: string | undefined = target;
          let password: string | undefined = options.password;

          // Initialize connectConfig if connection args are present
          let connectConfig: { user?: string, password?: string, url?: string } | undefined;

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

          // Determine mode
          if (options.file) {
              config = {
                  mode: 'script',
                  scriptFile: options.file,
                  stopOnError: options.e || false,
                  physicalFS: options.physicalFS,
                  connectConfig: connectConfig
              };
          } else if (options.command) {
              config = {
                  mode: 'execute',
                  commandToExecute: options.command,
                  stopOnError: options.e || false,
                  physicalFS: options.physicalFS,
                  connectConfig: connectConfig
              };
          } else if (target && existsSync(target)) {
              // Auto-detect script file: if target exists as a file, treat as script
              config = {
                  mode: 'script',
                  scriptFile: target,
                  stopOnError: options.e || false,
                  physicalFS: options.physicalFS
              };
          } else if (connectConfig) {
              config = {
                  mode: 'connect',
                  physicalFS: options.physicalFS,
                  connectConfig: connectConfig
              };
          } else {
              config = {
                  mode: 'interactive',
                  physicalFS: options.physicalFS
              };
          }

          // Apply startup preference toggles when provided
          if (typeof options.prefetchFeeds === 'boolean') {
            config.prefetchFeeds = options.prefetchFeeds;
          }
          if (typeof options.prefetchPublicFeeds === 'boolean') {
            config.prefetchPublicFeeds = options.prefetchPublicFeeds;
          }
          if (typeof options.prefetchPlugins === 'boolean') {
            config.prefetchPlugins = options.prefetchPlugins;
          }
          if (typeof options.asciiBoot === 'boolean') {
            config.asciiBoot = options.asciiBoot;
          }
          if (typeof options.logo === 'boolean') {
            config.showLogo = options.logo;
          }
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
