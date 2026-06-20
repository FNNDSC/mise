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
  paths: string[];
}

/**
 * Parses `pull` arguments: the `--nowait` flag, `--retry N`, and path operands.
 *
 * @param args - Raw command arguments.
 * @returns The parsed flags and paths.
 */
export function pullArgs_parse(args: string[]): PullArgs {
  const nowait: boolean = args.includes('--nowait');
  let retryMax: number = 0;
  const paths: string[] = [];

  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '--retry' && i + 1 < args.length) {
      const n: number = parseInt(args[++i], 10);
      if (!isNaN(n) && n >= 0) retryMax = n;
    } else if (!args[i].startsWith('--')) {
      paths.push(args[i]);
    }
  }

  return { nowait, retryMax, paths };
}
