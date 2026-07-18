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
 * Parses `pull` arguments: `--nowait`, `--retry N`, `--new-feed TITLE`, and
 * path operands.
 *
 * @param args - Raw command arguments.
 * @returns The parsed flags and paths.
 */
export function pullArgs_parse(args: string[]): PullArgs {
  const nowait: boolean = args.includes('--nowait');
  let retryMax: number = 0;
  let newFeedTitle: string | null = null;
  let parseError: string | null = null;
  const paths: string[] = [];

  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '--nowait') {
      continue;
    } else if (args[i] === '--retry') {
      const value: string | undefined = args[i + 1];
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
    } else if (args[i] === '--new-feed') {
      if (newFeedTitle !== null) {
        parseError = '--new-feed may only be specified once';
      }
      const title: string | undefined = args[i + 1];
      if (title === undefined || title.startsWith('--') || title.trim().length === 0) {
        parseError ??= '--new-feed requires a title';
      } else {
        newFeedTitle = title.trim();
        i++;
      }
    } else if (args[i].startsWith('--')) {
      parseError ??= `unsupported option: ${args[i]}`;
    } else {
      paths.push(args[i]);
    }
  }

  return { nowait, retryMax, newFeedTitle, parseError, paths };
}
