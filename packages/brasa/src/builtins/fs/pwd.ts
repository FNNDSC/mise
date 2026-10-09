/**
 * @file Builtin pwd command.
 * Reports the current working directory as a command envelope.
 */
import { session } from '../../session/index.js';
import { backendInstalled_get } from '../../core/backend.js';
import { CommandEnvelope, envelope_ok } from '@fnndsc/menu';

/**
 * Reports the current working directory in the ChRIS filesystem context.
 *
 * @param args - Command arguments (--title flag supported).
 * @returns An envelope whose rendered text is the directory (with feed and
 *   plugin segments replaced by titles under --title) and whose model
 *   carries the raw path.
 */
export async function builtin_pwd(args: string[] = []): Promise<CommandEnvelope> {
  return pwd_run({ titles: args.includes('--title') });
}

/** Typed invocation options for pwd. */
export interface PwdOptions {
  /** Replace feed/plugin path segments with their human titles. */
  titles?: boolean;
}

/**
 * Reports the current working directory: the shared typed core behind the
 * parsed builtin and the typed API.
 *
 * @param options - Title substitution preference.
 * @returns An envelope carrying the fs.cwd model.
 */
export async function pwd_run(options: PwdOptions = {}): Promise<CommandEnvelope> {
  const showTitles: boolean = options.titles ?? false;
  const cwd: string = await session.getCWD();
  const shown: string = showTitles ? await path_withTitles(cwd) : cwd;
  return envelope_ok(`${shown}\n`, { kind: 'fs.cwd', data: { path: cwd, shown } });
}

/**
 * Replaces each path segment the backend titles (ChRIS: a feed, a plugin
 * instance) with its title.
 *
 * @param path - The path to process.
 * @returns The path with titles in place of the segments that have them.
 */
async function path_withTitles(path: string): Promise<string> {
  const title: ((segment: string) => Promise<string | null>) | undefined = backendInstalled_get()?.vfs?.segment_title;
  if (title === undefined) return path;
  const parts: string[] = path.split('/');
  const replacedParts: string[] = await Promise.all(
    parts.map(async (part: string): Promise<string> => (await title(part)) ?? part),
  );
  return replacedParts.join('/');
}
