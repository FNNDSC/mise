/**
 * @file Builtin url: a web address that opens ARGUS at a path.
 *
 * A colleague handed a node used to paste a long `pwd` into chat, and the
 * one receiving it walked down to it by hand. `url <path>` prints the
 * door's address with the path as its fragment; ARGUS reads the fragment
 * when it opens and lands there: a feed or a node in RUNS, anything else
 * in FILES. The path is the session's resolved absolute path, so the link
 * names the same place for anyone the feed is shared with.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_error, envelope_ok } from '@fnndsc/menu';
import { session } from '../../session/index.js';
import { path_resolve } from '../utils.js';
import { exitCode_set } from '../../core/handlerRun.js';

/** The environment variable naming the door (porter) a link opens through. */
export const URL_DOOR_ENV: string = 'CHELL_DOOR';

/**
 * The address a link opens: the door with the path as its fragment.
 *
 * @param door - The door's base address, or empty for none.
 * @param absolutePath - The resolved path.
 * @returns The link, or the bare fragment when there is no door.
 */
export function url_compose(door: string, absolutePath: string): string {
  const fragment: string = `#${encodeURI(absolutePath)}`;
  if (door === '') return fragment;
  return `${door.replace(/\/+$/, '')}/${fragment}`;
}

/**
 * Prints a web address that opens ARGUS at a path (the cwd when none).
 *
 * @param args - The path, optionally.
 * @param env - The environment the door is read from.
 * @returns An envelope carrying the link and its `fs.url` model.
 */
export async function builtin_url(args: string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<CommandEnvelope> {
  const words: string[] = args.filter((word: string): boolean => !word.startsWith('--'));
  if (words.length > 1) {
    exitCode_set(1);
    return envelope_error('', undefined, `${chalk.red('Usage: url [path]')}\n`);
  }
  const absolute: string = words.length === 0 ? await session.getCWD() : await path_resolve(words[0] as string);
  const door: string = (env[URL_DOOR_ENV] ?? '').trim();
  const link: string = url_compose(door, absolute);
  const rendered: string = door === ''
    ? `${link}\n${chalk.dim(`No door is known to this session (${URL_DOOR_ENV} is unset): put the door's address in front, e.g. https://titan.tch.harvard.edu/${link}`)}\n`
    : `${link}\n`;
  return envelope_ok(rendered, { kind: 'fs.url', data: { path: absolute, url: link } });
}
