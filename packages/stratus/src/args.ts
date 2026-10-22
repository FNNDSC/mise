/**
 * @file The `stratus` command line: what it takes, and the refusal of
 * anything else by name.
 *
 * @module
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** What the command line asked for. */
export interface StratusArgs {
  readonly profile?: string;
  readonly configFile?: string;
  readonly region?: string;
  readonly fake: boolean;
  readonly help: boolean;
  /** `--domain <name>=<checkout>`, as many as given. */
  readonly domains: ReadonlyArray<{ readonly name: string; readonly root: string }>;
}

/** The value after a `--flag VALUE` or `--flag=VALUE`, or undefined. */
function flagValue_get(argv: ReadonlyArray<string>, flag: string): string | undefined {
  const at: number = argv.indexOf(flag);
  if (at !== -1) return argv[at + 1];
  const joined: string | undefined = argv.find((arg: string): boolean => arg.startsWith(`${flag}=`));
  return joined?.slice(flag.length + 1);
}

/**
 * Reads `<name>=<checkout>`: a name that is a path segment, and a checkout,
 * `~` meaning the home directory.
 *
 * @param given - The word.
 * @returns The domain, or null when the word is not one.
 */
export function domainArg_parse(given: string): { name: string; root: string } | null {
  const equals: number = given.indexOf('=');
  if (equals <= 0 || equals === given.length - 1) return null;
  const name: string = given.slice(0, equals);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  const path: string = given.slice(equals + 1);
  const root: string = path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
  return { name, root };
}

/**
 * Parses the command line; unknown words are refused by name, as the house
 * rule says.
 *
 * @param argv - The arguments after the command.
 * @returns The arguments, or the refusal.
 */
export function stratusArgs_parse(argv: ReadonlyArray<string>): { args: StratusArgs } | { error: string } {
  const known: ReadonlyArray<string> = ['--profile', '--config', '--region', '--fake', '--help', '-h', '--host-control', '--expose-host-control', '--domain'];
  const valued: ReadonlyArray<string> = ['--profile', '--config', '--region', '--host-control'];
  const domains: Array<{ name: string; root: string }> = [];
  for (let i = 0; i < argv.length; i++) {
    const word: string = argv[i];
    if (word === '--domain') {
      const given: string | undefined = argv[i + 1];
      const domain: { name: string; root: string } | null = given === undefined ? null : domainArg_parse(given);
      if (domain === null) return { error: `--domain takes <name>=<harbor-oci checkout>, not '${given ?? ''}'` };
      domains.push(domain);
      i++;
      continue;
    }
    const name: string = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
    if (!known.includes(name)) return { error: `unknown option '${word}' (stratus --help)` };
    if (name === '--domain') {
      const domain: { name: string; root: string } | null = domainArg_parse(word.slice('--domain='.length));
      if (domain === null) return { error: `--domain takes <name>=<harbor-oci checkout>, not '${word.slice('--domain='.length)}'` };
      domains.push(domain);
      continue;
    }
    if (valued.includes(name) && !word.includes('=') && name !== '--host-control') i++;
  }
  return {
    args: {
      profile: flagValue_get(argv, '--profile'),
      configFile: flagValue_get(argv, '--config'),
      region: flagValue_get(argv, '--region'),
      fake: argv.includes('--fake'),
      help: argv.includes('--help') || argv.includes('-h'),
      domains,
    },
  };
}
