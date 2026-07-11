/**
 * @file Pure argument parsing for the `pipeline run` subcommand.
 *
 * Dependency-free for easy unit testing.
 *
 * @module
 */

/**
 * Optional overrides parsed from `pipeline run` arguments.
 */
export interface PipelineRunOverrides {
  computeOverride: string | undefined;
  previousOverride: number | undefined;
}

/**
 * Parses `--compute <resource>` and `--previous <inst_id>` overrides from
 * `pipeline run <name|id> ...` arguments (scanning from index 2).
 *
 * @param args - The full `pipeline run` argument list.
 * @returns The parsed overrides.
 */
export function pipelineRunArgs_parse(args: string[]): PipelineRunOverrides {
  let computeOverride: string | undefined;
  let previousOverride: number | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--compute' && i + 1 < args.length) {
      computeOverride = args[++i];
    } else if (args[i] === '--previous' && i + 1 < args.length) {
      previousOverride = parseInt(args[++i], 10);
    }
  }

  return { computeOverride, previousOverride };
}
