/**
 * @file The run line a bound catalogue composes, as text the console would take.
 *
 * The line is authoritative and editable by hand, so nothing here keeps a
 * model beside it: a VALUE typed into a node's dive is written INTO the line
 * as the flag the console would take, a value read back is read FROM the
 * line, and a hand edit stands because it is the line. The grammar is the
 * kernel's: `cd "<input>"; <exe> [--flag value …] [-- feed_title="…"]`, a
 * bare `--flag` for a boolean, and for a pipeline `--<node>.<param> value`
 * where the node is its title when the title is shell-safe and unique, else
 * `@<pipingId>`.
 *
 * @module
 */

/** A flag's value as the line carries it: text, bare (true), or absent. */
export type RunFlagValue = string | true | null;

/** The line in its three parts: up to the executable, its arguments, the context after ` -- `. */
interface RunLineParts {
  head: string;
  args: string;
  tail: string;
}

/** The kernel's context delimiter, as it stands on a line. */
const CONTEXT_DELIMITER: RegExp = /\s--(?:\s|$)/;

/**
 * Splits a line into what precedes the arguments, the arguments, and the
 * context clause. The executable is the last command's first word.
 *
 * @param line - The line as the strip holds it.
 * @returns The parts; `tail` keeps its leading ` -- `.
 */
function runLine_split(line: string): RunLineParts {
  const delimiter: RegExpExecArray | null = CONTEXT_DELIMITER.exec(line);
  const before: string = delimiter === null ? line : line.slice(0, delimiter.index);
  const tail: string = delimiter === null ? '' : line.slice(delimiter.index);
  const lastCommand: number = before.lastIndexOf(';');
  const commandStart: number = lastCommand === -1 ? 0 : lastCommand + 1;
  const command: string = before.slice(commandStart);
  const exe: RegExpExecArray | null = /^\s*\S+/.exec(command);
  const headEnd: number = commandStart + (exe === null ? command.length : exe[0].length);
  return { head: before.slice(0, headEnd), args: before.slice(headEnd), tail };
}

/**
 * Composes the line RUN starts from: the input as the working directory,
 * then the executable.
 *
 * @param input - The bound input directory.
 * @param executable - The `/bin` entry.
 * @returns The line.
 */
export function runLine_compose(input: string, executable: string): string {
  return `cd "${input}"; ${executable}`;
}

/**
 * Quotes a value the way the console needs it: bare when it is one plain
 * word, double-quoted otherwise.
 *
 * @param value - The value as typed.
 * @returns The token.
 */
function value_quote(value: string): string {
  return /^[A-Za-z0-9_./:@+=,-]+$/.test(value) ? value : `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Tokenises an argument string, honouring double quotes.
 *
 * @param args - The argument clause.
 * @returns The tokens, quotes kept.
 */
function args_tokenise(args: string): string[] {
  const tokens: string[] = [];
  const pattern: RegExp = /"(?:[^"\\]|\\.)*"|\S+/g;
  let match: RegExpExecArray | null = pattern.exec(args);
  while (match !== null) {
    tokens.push(match[0]);
    match = pattern.exec(args);
  }
  return tokens;
}

/**
 * Reads a token back as the value it carries.
 *
 * @param token - A token, possibly quoted.
 * @returns The value.
 */
function token_unquote(token: string): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return token;
}

/**
 * Whether a token is an option rather than a value.
 *
 * @param token - The token.
 * @returns True for `--x` and `-x` (but not a lone `-` or a negative number).
 */
function token_isOption(token: string): boolean {
  return token.startsWith('-') && token !== '-' && !/^-\d/.test(token);
}

/**
 * Reads what the line says for a flag.
 *
 * @param line - The line.
 * @param flag - The flag, as typed (`--prefix`).
 * @returns Its value, `true` when bare, null when absent.
 */
export function runLine_flagGet(line: string, flag: string): RunFlagValue {
  const tokens: string[] = args_tokenise(runLine_split(line).args);
  for (let index: number = 0; index < tokens.length; index++) {
    const token: string = tokens[index] ?? '';
    if (token === flag) {
      const next: string | undefined = tokens[index + 1];
      return next === undefined || token_isOption(next) ? true : token_unquote(next);
    }
    if (token.startsWith(`${flag}=`)) return token_unquote(token.slice(flag.length + 1));
  }
  return null;
}

/**
 * Writes a flag into the line: replaces it where it stands, appends it when
 * new, removes it when the value is null or empty. Every other token, hand
 * typed or not, stays exactly as it was.
 *
 * @param line - The line.
 * @param flag - The flag, as typed (`--prefix`).
 * @param value - Text, `true` for a bare flag, or null to remove it.
 * @returns The rewritten line.
 */
export function runLine_flagSet(line: string, flag: string, value: RunFlagValue): string {
  const parts: RunLineParts = runLine_split(line);
  const tokens: string[] = args_tokenise(parts.args);
  const kept: string[] = [];
  let placed: boolean = false;
  const written: string[] = value === null || value === '' ? [] : value === true ? [flag] : [flag, value_quote(value)];
  for (let index: number = 0; index < tokens.length; index++) {
    const token: string = tokens[index] ?? '';
    if (token === flag || token.startsWith(`${flag}=`)) {
      if (token === flag) {
        const next: string | undefined = tokens[index + 1];
        if (next !== undefined && !token_isOption(next)) index++;
      }
      if (!placed) { kept.push(...written); placed = true; }
      continue;
    }
    kept.push(token);
  }
  if (!placed) kept.push(...written);
  const args: string = kept.length === 0 ? '' : ` ${kept.join(' ')}`;
  return `${parts.head}${args}${parts.tail}`;
}

/**
 * Whether the line already carries a feed title.
 *
 * @param line - The line.
 * @returns True when a `feed_title` stands after the delimiter.
 */
export function runLine_hasTitle(line: string): boolean {
  return /\bfeed_title=/.test(runLine_split(line).tail);
}

/**
 * Appends the feed title the kernel's context clause takes.
 *
 * @param line - The line.
 * @param title - The title as answered.
 * @returns The line with its context clause.
 */
export function runLine_titleAppend(line: string, title: string): string {
  return `${line} -- feed_title="${title.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * The executable the line runs: the last command's first word.
 *
 * @param line - The line.
 * @returns The executable, or '' when the line has none.
 */
export function runLine_executable(line: string): string {
  return runLine_split(line).head.replace(/^.*;\s*/, '').trim();
}

/**
 * The node selector a pipeline's compound option uses: the title when it is
 * shell-safe and unique among the pipeline's nodes, else `@<pipingId>`.
 *
 * @param title - The node's title.
 * @param pipingId - The node's piping id.
 * @param titles - Every node title in the pipeline.
 * @returns The selector.
 */
export function pipelineNode_selector(title: string, pipingId: string, titles: ReadonlyArray<string>): string {
  const usable: boolean = /^[A-Za-z0-9_-]+$/.test(title)
    && titles.filter((candidate: string): boolean => candidate === title).length === 1;
  return usable ? title : `@${pipingId}`;
}
