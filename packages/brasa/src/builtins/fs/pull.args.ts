/**
 * @file Pure argument parsing for the `pull` builtin.
 *
 * Dependency-free so it is trivially unit-testable.
 *
 * @module
 */

/**
 * Parsed `pull` arguments.
 */
export interface PullArgs {
  nowait: boolean;
  retryMax: number;
  newFeedTitle: string | null;
  parseError: string | null;
  paths: string[];
}

/**
 * Parses `pull` arguments: `--detach` (`--nowait`), `--retry N`, `--new-feed TITLE`, and
 * path operands.
 *
 * @param args - Raw command arguments.
 * @returns The parsed flags and paths.
 */
export function pullArgs_parse(args: string[]): PullArgs {
  const commandArgs: string[] = args;
  // `--detach` is the language's word for it; `--nowait` is what pull
  // called it first and still answers to.
  const nowait: boolean = commandArgs.includes('--nowait') || commandArgs.includes('--detach');
  let retryMax: number = 0;
  let newFeedTitle: string | null = null;
  let parseError: string | null = null;
  const paths: string[] = [];

  for (let i: number = 0; i < commandArgs.length; i++) {
    if (commandArgs[i] === '--nowait' || commandArgs[i] === '--detach') {
      continue;
    } else if (commandArgs[i] === '--retry') {
      const value: string | undefined = commandArgs[i + 1];
      if (value === undefined || value.startsWith('--')) {
        parseError ??= '--retry requires a non-negative integer';
        continue;
      }
      i++;
      const n: number = Number(value);
      if (Number.isInteger(n) && n >= 0) {
        retryMax = n;
      } else {
        parseError ??= '--retry requires a non-negative integer';
      }
    } else if (commandArgs[i] === '--new-feed') {
      if (newFeedTitle !== null) {
        parseError = '--new-feed may only be specified once';
      }
      const title: string | undefined = commandArgs[i + 1];
      if (title === undefined || title.startsWith('--') || title.trim().length === 0) {
        parseError ??= '--new-feed requires a title';
      } else {
        newFeedTitle = title.trim();
        i++;
      }
    } else if (commandArgs[i] === '--plugin' || commandArgs[i] === '--pipeline') {
      // Pulling lands data; running over it is `gather process`, or a run
      // by name where the pull's feed stands.
      parseError ??= `${commandArgs[i]} is retired: pull lands the data; run over it with gather process <name>, or cd into the feed and run by name`;
    } else if (commandArgs[i].startsWith('--')) {
      parseError ??= `unsupported option: ${commandArgs[i]}`;
    } else {
      paths.push(commandArgs[i]);
    }
  }

  return { nowait, retryMax, newFeedTitle, parseError, paths };
}
