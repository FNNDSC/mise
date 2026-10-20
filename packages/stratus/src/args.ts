/**
 * @file The `stratus` command line: what it takes, and the refusal of
 * anything else by name.
 *
 * @module
 */

/** What the command line asked for. */
export interface StratusArgs {
  readonly profile?: string;
  readonly configFile?: string;
  readonly region?: string;
  readonly fake: boolean;
  readonly help: boolean;
}

/** The value after a `--flag VALUE` or `--flag=VALUE`, or undefined. */
function flagValue_get(argv: ReadonlyArray<string>, flag: string): string | undefined {
  const at: number = argv.indexOf(flag);
  if (at !== -1) return argv[at + 1];
  const joined: string | undefined = argv.find((arg: string): boolean => arg.startsWith(`${flag}=`));
  return joined?.slice(flag.length + 1);
}

/**
 * Parses the command line; unknown words are refused by name, as the house
 * rule says.
 *
 * @param argv - The arguments after the command.
 * @returns The arguments, or the refusal.
 */
export function stratusArgs_parse(argv: ReadonlyArray<string>): { args: StratusArgs } | { error: string } {
  const known: ReadonlyArray<string> = ['--profile', '--config', '--region', '--fake', '--help', '-h', '--host-control', '--expose-host-control'];
  const valued: ReadonlyArray<string> = ['--profile', '--config', '--region', '--host-control'];
  for (let i = 0; i < argv.length; i++) {
    const word: string = argv[i];
    const name: string = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
    if (!known.includes(name)) return { error: `unknown option '${word}' (stratus --help)` };
    if (valued.includes(name) && !word.includes('=') && name !== '--host-control') i++;
  }
  return {
    args: {
      profile: flagValue_get(argv, '--profile'),
      configFile: flagValue_get(argv, '--config'),
      region: flagValue_get(argv, '--region'),
      fake: argv.includes('--fake'),
      help: argv.includes('--help') || argv.includes('-h'),
    },
  };
}
