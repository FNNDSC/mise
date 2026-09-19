/**
 * @file Builtin play command: running a manifest.
 *
 * A manifest is a text file of the lines an operator could have typed. It is
 * not a second language and it has no runtime of its own: `play` reads the
 * file and feeds its lines to the session one at a time, through the same
 * path a typed line takes. That is the whole trick — because every verb
 * lowers to a line and every line's answer is a typed model the surface
 * renders, a manifest played at a surface PLAYS: the PACS pane fills, the
 * cohort's face counts up, a viewer opens. Played headlessly, the same file
 * prints the same envelopes and exits 0 or non-zero. Neither run knows which
 * it is.
 *
 * The file may say what it needs (`@param`) and what it is (`@name`), and
 * may refer to what the session just did through a closed set of pronouns.
 * It may not say where anything goes: placement is the surface's judgment,
 * and a manifest that named panes would fork into a browser version and a
 * headless one.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { Result } from '@fnndsc/cumin';
import { fileContent_get } from '@fnndsc/salsa';
import { path_resolve } from '../utils.js';
import { session } from '../../session/index.js';
import { cohort_read, GatherMember, GatherState } from './gather.store.js';
import { recentFeed_get, recentQuery_get, recentRuns_get } from '../../session/recent.js';
import { sink_dataLine, sink_errLine } from '../../core/sink.js';
import { commandCancellation_enable, commandCancellation_signalGet } from '../../core/cancellation.js';

/** The model kind under which a played manifest's outcome travels. */
export const PLAY_MODEL_KIND: string = 'manifest.played';

/** A manifest may play a manifest; a manifest may not play itself forever. */
const NESTING_MAX: number = 2;

/** How deep the current play is. */
let depth: number = 0;

/** One parameter a manifest declares. */
export interface ManifestParam {
  name: string;
  fallback?: string;
}

/** One line of a manifest, with where it came from. */
export interface ManifestLine {
  /** 1-based line number in the file, so a refusal can point at it. */
  number: number;
  text: string;
}

/** A manifest, read. */
export interface Manifest {
  name: string | null;
  description: string | null;
  params: ManifestParam[];
  lines: ManifestLine[];
}

/** What a play did. */
export interface PlayOutcome {
  manifest: string;
  /** Lines that ran, in order. */
  ran: number;
  /** Lines the file holds. */
  total: number;
  /** The line a refusal stopped on, when one did. */
  stoppedAt: number | null;
  /** How long the play took. */
  elapsedMs: number;
}

/**
 * Reads a manifest.
 *
 * Header directives are collected wherever they appear and take effect
 * before the first line runs, so a file cannot half-declare itself.
 *
 * @param text - The file's content.
 * @returns What the file says, and the lines to run.
 */
export function manifest_parse(text: string): Manifest {
  const params: ManifestParam[] = [];
  const lines: ManifestLine[] = [];
  let name: string | null = null;
  let description: string | null = null;

  const raw: string[] = text.split('\n');
  for (let index = 0; index < raw.length; index++) {
    const line: string = raw[index];
    const trimmed: string = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('@')) {
      const space: number = trimmed.search(/\s/);
      const directive: string = space === -1 ? trimmed : trimmed.slice(0, space);
      const value: string = space === -1 ? '' : trimmed.slice(space + 1).trim();
      if (directive === '@name') name = value;
      else if (directive === '@description') description = value;
      else if (directive === '@param') {
        const equals: number = value.indexOf('=');
        if (equals === -1) params.push({ name: value.trim() });
        else params.push({ name: value.slice(0, equals).trim(), fallback: value.slice(equals + 1).trim() });
      }
      continue;
    }

    lines.push({ number: index + 1, text: trimmed });
  }

  return { name, description, params, lines };
}

/**
 * Quotes a path if it holds anything a line would break on.
 *
 * A PACS series path carries parentheses, commas and spaces: substituted
 * bare, one gathered series becomes several operands and the line means
 * something else.
 *
 * @param value - The value to place in a line.
 * @returns The value, quoted when it needs to be.
 */
function operand_quote(value: string): string {
  if (/^[A-Za-z0-9/._:@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Resolves one pronoun against the session.
 *
 * @param token - The pronoun, without its `${}`.
 * @returns Its value, or null when the session cannot answer it.
 */
async function pronoun_resolve(token: string): Promise<string | null> {
  if (token === 'cwd') return await session.getCWD();

  if (token === 'feed') {
    const feed: number | null = recentFeed_get();
    return feed === null ? null : `${feed}`;
  }

  if (token === 'run') {
    const runs: number[] = recentRuns_get();
    return runs.length === 0 ? null : `${runs[runs.length - 1]}`;
  }

  if (token === 'query') {
    const query: string | null = recentQuery_get();
    return query === null ? null : operand_quote(query);
  }

  if (token === 'gather' || token.startsWith('gather.')) {
    const state: GatherState = await cohort_read();
    // A member has two addresses and the difference matters: where it was
    // GATHERED from (what `pull` takes) and where it LANDED (what `image`
    // and a run take). `.place` asks for the second, and says so when a
    // member does not have one yet rather than handing over a PACS path
    // that a viewer will refuse for reasons of its own.
    const wantsPlace: boolean = token.endsWith('.place');
    const stem: string = wantsPlace ? token.slice(0, -'.place'.length) : token;
    const addressOf = (member: GatherMember): string | null => {
      if (!wantsPlace) return member.vfsPath;
      const landed: unknown = member.folderPath;
      if (typeof landed === 'string' && landed.length > 0) return landed;
      return member.kind === 'series' ? null : member.vfsPath;
    };

    const members: GatherMember[] = state.series;
    if (stem === 'gather') {
      const addresses: Array<string | null> = members.map(addressOf);
      if (addresses.some((address: string | null): boolean => address === null)) return null;
      return (addresses as string[]).map(operand_quote).join(' ');
    }

    const which: string = stem.slice('gather.'.length);
    if (which === 'size') return `${members.length}`;
    if (which === 'name') return state.name ?? '';

    const pick = (member: GatherMember | undefined): string | null => {
      if (member === undefined) return null;
      const address: string | null = addressOf(member);
      return address === null ? null : operand_quote(address);
    };
    if (which === 'first') return pick(members[0]);
    if (which === 'last') return pick(members[members.length - 1]);
    const nth: number = Number(which);
    if (Number.isInteger(nth) && nth >= 1 && nth <= members.length) return pick(members[nth - 1]);
    return null;
  }

  return null;
}

/** A line with everything filled in, or the reason it could not be. */
type Expansion = { text: string } | { refusal: string };

/**
 * Fills in a line's parameters and pronouns.
 *
 * @param line - The line as written.
 * @param values - Parameter values, already checked for completeness.
 * @returns The line to run, or why it cannot be built.
 */
export async function line_expand(line: string, values: Map<string, string>): Promise<Expansion> {
  const tokens: string[] = [...line.matchAll(/\$\{([^}]+)\}/g)].map((match): string => match[1]);
  let text: string = line;

  for (const token of tokens) {
    const asParam: string | undefined = values.get(token);
    if (asParam !== undefined) {
      text = text.replace(`\${${token}}`, asParam);
      continue;
    }
    const asPronoun: string | null = await pronoun_resolve(token);
    if (asPronoun === null) {
      return {
        refusal: `\${${token}} — the session has nothing to put there`
          + (token === 'feed' ? ' (nothing has created a feed yet)' : '')
          + (token.endsWith('.place') ? ' (a member is not in CUBE yet — pull it first)' : ''),
      };
    }
    text = text.replace(`\${${token}}`, asPronoun);
  }

  return { text };
}

/**
 * Sleeps between lines, unless the play is cancelled.
 *
 * @param ms - How long to wait.
 * @param signal - The foreground command's abort signal.
 * @returns True when the pause completed.
 */
async function pause_take(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) return false;
  return await new Promise<boolean>((resolve): void => {
    const onAbort = (): void => { clearTimeout(timer); resolve(false); };
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** How a play was asked for. */
interface PlayArgs {
  manifest: string | null;
  params: Map<string, string>;
  paceMs: number;
  dryRun: boolean;
  parseError: string | null;
}

/**
 * Parses `play`'s own arguments.
 *
 * Hand-parsed because `--param` repeats, and a generic parser keeps only the
 * last of a repeated option — which would silently drop every parameter but
 * one and play the manifest with the wrong values.
 *
 * @param args - The tokens after `play`.
 * @returns What was asked for.
 */
export function playArgs_parse(args: string[]): PlayArgs {
  const params: Map<string, string> = new Map();
  let manifest: string | null = null;
  let paceMs: number = 0;
  let dryRun: boolean = false;
  let parseError: string | null = null;

  for (let index = 0; index < args.length; index++) {
    const token: string = args[index];
    if (token === '--param') {
      const pair: string | undefined = args[index + 1];
      const equals: number = pair === undefined ? -1 : pair.indexOf('=');
      if (pair === undefined || equals <= 0) {
        parseError = '--param takes NAME=value';
        break;
      }
      params.set(pair.slice(0, equals), pair.slice(equals + 1));
      index++;
    } else if (token === '--pace') {
      const value: string | undefined = args[index + 1];
      const ms: number = value === undefined ? Number.NaN : Number(value.replace(/s$/, '')) * (value.endsWith('ms') ? 1 : 1000);
      if (!Number.isFinite(ms) || ms < 0) {
        parseError = '--pace takes a duration such as 2s';
        break;
      }
      paceMs = ms;
      index++;
    } else if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--step') {
      // A keypress needs a terminal, and the daemon has none. Refusing by
      // name beats pausing forever on a surface that cannot answer.
      parseError = '--step needs a terminal; at a surface, play with --pace';
      break;
    } else if (token.startsWith('--')) {
      parseError = `unknown option ${token}`;
      break;
    } else if (manifest === null) {
      manifest = token;
    } else {
      parseError = `unexpected argument ${token}`;
      break;
    }
  }

  return { manifest, params, paceMs, dryRun, parseError };
}

/**
 * Builtin handler for the `play` command.
 *
 * @param args - Parsed command arguments.
 * @returns An envelope carrying what the play did, or the refusal that stopped it.
 */
export async function builtin_play(args: string[]): Promise<CommandEnvelope> {
  const parsed: PlayArgs = playArgs_parse(args);
  if (parsed.parseError !== null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`play: ${parsed.parseError}`)}\n`);
  }
  if (parsed.manifest === null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: play <manifest> [--param NAME=value]... [--pace <duration>] [--dry-run]')}\n`);
  }
  if (depth >= NESTING_MAX) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`play: ${parsed.manifest} is nested too deep — a manifest may play a manifest, not a chain of them.`)}\n`);
  }

  const resolved: string = await path_resolve(parsed.manifest);
  const content: Result<string> = await fileContent_get(resolved);
  if (!content.ok) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`play: cannot read ${resolved}`)}\n`);
  }

  const manifest: Manifest = manifest_parse(content.value);

  // Everything the file needs is settled BEFORE the first line runs: a
  // manifest that gets half way and then asks has already changed the
  // session, and the operator cannot un-ask it.
  const values: Map<string, string> = new Map();
  const missing: string[] = [];
  for (const param of manifest.params) {
    const given: string | undefined = parsed.params.get(param.name);
    if (given !== undefined) values.set(param.name, given);
    else if (param.fallback !== undefined) values.set(param.name, param.fallback);
    else missing.push(param.name);
  }
  for (const [key, value] of parsed.params) values.set(key, value);

  if (missing.length > 0) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(
      `play: ${manifest.name ?? parsed.manifest} needs ${missing.map((name: string): string => `--param ${name}=…`).join(' ')}`,
    )}\n`);
  }

  if (manifest.name !== null) sink_dataLine(chalk.bold(manifest.name));
  if (manifest.description !== null) sink_dataLine(chalk.gray(manifest.description));

  const started: number = Date.now();
  if (parsed.paceMs > 0) commandCancellation_enable();
  const signal: AbortSignal | undefined = parsed.paceMs > 0 ? commandCancellation_signalGet() : undefined;

  const { line_execute } = await import('../../core/engine.js');
  let ran: number = 0;
  let stoppedAt: number | null = null;

  depth += 1;
  try {
    for (const line of manifest.lines) {
      const expanded: Expansion = await line_expand(line.text, values);
      if ('refusal' in expanded) {
        sink_errLine(chalk.red(`✗ ${parsed.manifest}:${line.number}: ${expanded.refusal}`));
        stoppedAt = line.number;
        break;
      }

      // The line is SHOWN before it runs, so a play reads as a session
      // being driven rather than as output appearing from nowhere.
      sink_dataLine(chalk.cyan(`▸ ${expanded.text}`));
      if (parsed.dryRun) { ran += 1; continue; }

      const envelopes: CommandEnvelope[] = await line_execute(expanded.text);
      ran += 1;
      const refused: boolean = envelopes.some((envelope: CommandEnvelope): boolean => envelope.status === 'error');
      if (refused || process.exitCode === 1) {
        // A workflow whose first half failed has a second half that is
        // noise: the play stops where the trouble is.
        sink_errLine(chalk.red(`✗ ${parsed.manifest}:${line.number} refused — stopping.`));
        stoppedAt = line.number;
        break;
      }

      if (parsed.paceMs > 0 && !await pause_take(parsed.paceMs, signal)) {
        sink_dataLine(chalk.yellow(`play: stopped at ${parsed.manifest}:${line.number}`));
        stoppedAt = line.number;
        break;
      }
    }
  } finally {
    depth -= 1;
  }

  const outcome: PlayOutcome = {
    manifest: parsed.manifest,
    ran,
    total: manifest.lines.length,
    stoppedAt,
    elapsedMs: Date.now() - started,
  };
  const model = { kind: PLAY_MODEL_KIND, data: outcome };
  const took: string = `${Math.round(outcome.elapsedMs / 1000)}s`;

  if (stoppedAt !== null) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`play: ${parsed.manifest} stopped at line ${stoppedAt} after ${ran} of ${manifest.lines.length} lines (${took})`)}\n`);
  }

  const what: string = parsed.dryRun ? 'would play' : 'played';
  return envelope_ok(`${chalk.green(`play: ${what} ${ran} line${ran === 1 ? '' : 's'} of ${parsed.manifest} (${took})`)}\n`, model);
}
