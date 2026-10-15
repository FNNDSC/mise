/**
 * @file The query keys a PACS ignores, and the hint that points at grep
 * (#1105).
 *
 * Asked by series or study description, the PACS behind ekanite answers as
 * if the key were not there (#1100's table: `SeriesDescription:*T1*` still
 * returns 299 of 300 series), so a query that reads as narrowed is not. The
 * query is run exactly as asked — its cache and record unchanged — and one
 * line says so, with the grep that does the narrowing.
 *
 * The keys are a list per server, in `~/.config/mise/pacs.json`
 * (`{"ignoredKeys": {"PACSDCM": ["SeriesDescription"]}}`); without that
 * file the server known to ignore them has its list built in.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The servers known to ignore description keys, when no file says otherwise. */
const IGNORED_DEFAULT: Readonly<Record<string, ReadonlyArray<string>>> = {
  PACSDCM: ['SeriesDescription', 'StudyDescription'],
};

/**
 * The per-server lists: the config file's when it has one, else the default.
 *
 * @param env - The environment (its XDG_CONFIG_HOME).
 * @returns Server identifier to the keys it ignores.
 */
export function ignoredKeys_read(env: NodeJS.ProcessEnv = process.env): Readonly<Record<string, ReadonlyArray<string>>> {
  const file: string = path.join(env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config'), 'mise', 'pacs.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const lists: unknown = (parsed as { ignoredKeys?: unknown }).ignoredKeys;
    if (lists !== null && typeof lists === 'object') {
      return Object.fromEntries(Object.entries(lists as Record<string, unknown>)
        .map(([server, keys]): [string, string[]] => [server, Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []]));
    }
  } catch {
    // No file, or not one we read: the default.
  }
  return IGNORED_DEFAULT;
}

/**
 * The hint for keys a server ignores, or null when it ignores none asked.
 *
 * @param terms - The query's keys and their values.
 * @param server - The server's identifier (`PACSDCM`).
 * @param lists - The per-server lists.
 * @returns The line, or null.
 */
export function ignoredKeys_hint(
  terms: Readonly<Record<string, ReadonlyArray<string>>>,
  server: string,
  lists: Readonly<Record<string, ReadonlyArray<string>>> = ignoredKeys_read(),
): string | null {
  const ignored: ReadonlyArray<string> = lists[server] ?? [];
  const asked: string[] = Object.keys(terms).filter((key: string): boolean => ignored.some((one: string): boolean => one.toLowerCase() === key.toLowerCase()));
  if (asked.length === 0) return null;
  // The grep that does what the key could not: its value without the PACS
  // wildcards, matched in any case.
  const words: string[] = asked.flatMap((key: string): string[] => (terms[key] ?? []).map((value: string): string => value.replace(/\*/g, '').trim())).filter((word: string): boolean => word !== '');
  const grep: string = words.length === 0 ? 'grep -i <text>' : `grep -i${words.map((word: string): string => ` -e '${word.replace(/'/g, `'\\''`)}'`).join('')}`;
  return `[!] the PACS (${server}) ignores ${asked.join(' and ')}: the answer is not narrowed by ${asked.length === 1 ? 'it' : 'them'}. Filter it with: query … | ${grep}`;
}
