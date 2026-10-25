/**
 * @file `echo` and `printf`: words and formatted text, written out.
 *
 * `echo` writes its words joined by a space and ends the line, and nothing
 * more: the System V and BSD echos disagree on `-n` and on backslashes, and
 * POSIX sends anything past plain words to printf, so this echo takes no
 * option and reads no escape. `printf` is POSIX's subset: `%s`, `%d`/`%i`
 * and `%%` with flags, width and precision, the escapes `\n`, `\t` and `\\`,
 * and the format reused while arguments remain. Anything past that is
 * refused by name rather than half done.
 *
 * Both answer with text and no model, as the text filters do, so
 * `A=$(echo …)` holds what was written.
 *
 * @module
 */
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/menu';

/** The options other echos take at the front of the line, which this one refuses so a word is never silently eaten. */
const ECHO_OPTIONS: ReadonlySet<string> = new Set(['-n', '-e', '-E']);

/** A conversion: `%`, flags, width, precision, then the letter. */
const CONVERSION: RegExp = /^%([-+ 0#]*)(\d*|\*)(?:\.(\d*|\*))?([a-zA-Z%])/;

/** What a format turned into, or why it could not be. */
type Formatted = { text: string } | { refused: string };

/**
 * `echo [WORD]…`: the words, joined by a space, on one line.
 *
 * @param args - The words after `echo`.
 * @returns The line.
 */
export async function builtin_echo(args: string[]): Promise<CommandEnvelope> {
  const option: string | undefined = args[0];
  if (option !== undefined && ECHO_OPTIONS.has(option)) {
    process.exitCode = 1;
    return envelope_error('', undefined, `echo: ${option}: echo takes no options; printf FORMAT [ARG]… writes anything else\n`);
  }
  return envelope_ok(`${args.join(' ')}\n`);
}

/**
 * Pads a converted value to a width, as the flags say.
 *
 * @param value - The converted value.
 * @param flags - The conversion's flags.
 * @param width - The width, or '' for none.
 * @param numeric - Whether `0` may pad it.
 * @returns The padded value.
 */
function value_pad(value: string, flags: string, width: string, numeric: boolean): string {
  const wanted: number = width === '' ? 0 : Number(width);
  if (value.length >= wanted) return value;
  if (flags.includes('-')) return value.padEnd(wanted);
  if (numeric && flags.includes('0')) {
    const sign: string = /^[-+ ]/.test(value) ? value[0] as string : '';
    return sign + value.slice(sign.length).padStart(wanted - sign.length, '0');
  }
  return value.padStart(wanted);
}

/**
 * Converts one argument under one conversion.
 *
 * @param letter - The conversion letter.
 * @param flags - Its flags.
 * @param width - Its width.
 * @param precision - Its precision, or undefined for none.
 * @param argument - The argument, or undefined when they ran out.
 * @returns The converted text, or why not.
 */
function argument_convert(letter: string, flags: string, width: string, precision: string | undefined, argument: string | undefined): Formatted {
  if (letter === 's') {
    const value: string = argument ?? '';
    const cut: string = precision === undefined ? value : value.slice(0, Number(precision || '0'));
    return { text: value_pad(cut, flags, width, false) };
  }
  // d and i, the only other letters that reach here.
  const word: string = argument === undefined || argument === '' ? '0' : argument;
  if (!/^[-+]?\d+$/.test(word)) return { refused: `printf: ${word}: not a whole number, for %${letter}` };
  const number: bigint = BigInt(word);
  let digits: string = (number < 0n ? -number : number).toString();
  if (precision !== undefined) digits = digits.padStart(Number(precision || '0'), '0');
  const sign: string = number < 0n ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  return { text: value_pad(sign + digits, precision === undefined ? flags : flags.replace('0', ''), width, true) };
}

/**
 * Writes a format once, taking arguments from the front of the queue.
 *
 * @param format - The format.
 * @param queue - The arguments still to take; consumed.
 * @returns The text with how many arguments it took, or why it could not.
 */
function format_apply(format: string, queue: string[]): { text: string; took: number } | { refused: string } {
  let text: string = '';
  let took: number = 0;
  for (let at: number = 0; at < format.length; at++) {
    const char: string = format[at] as string;
    if (char === '\\') {
      const next: string | undefined = format[at + 1];
      if (next === 'n') text += '\n';
      else if (next === 't') text += '\t';
      else if (next === '\\') text += '\\';
      else return { refused: `printf: \\${next ?? ''}: not an escape printf here reads; it reads \\n, \\t and \\\\` };
      at++;
      continue;
    }
    if (char !== '%') { text += char; continue; }
    const match: RegExpMatchArray | null = format.slice(at).match(CONVERSION);
    if (match === null) return { refused: `printf: ${format.slice(at)}: a % with no conversion; %% writes one` };
    const flags: string = match[1] ?? '';
    if (flags.includes('#')) return { refused: 'printf: the # flag is not read here; it reads - 0 + and space' };
    if (match[2] === '*' || match[3] === '*') return { refused: 'printf: a * width or precision is not read here; write the number in the format' };
    const width: string = match[2] ?? '';
    const precision: string | undefined = match[3];
    const letter: string = match[4] ?? '';
    at += match[0].length - 1;
    if (letter === '%') { text += '%'; continue; }
    if (!['s', 'd', 'i'].includes(letter)) return { refused: `printf: %${letter}: not a conversion printf here does; it does %s, %d and %i` };
    const argument: string | undefined = queue.shift();
    if (argument !== undefined) took++;
    const converted: Formatted = argument_convert(letter, flags, width, precision, argument);
    if ('refused' in converted) return converted;
    text += converted.text;
  }
  return { text, took };
}

/**
 * Writes a format with its arguments, the format again while arguments
 * remain, as POSIX printf does.
 *
 * @param format - The format.
 * @param args - The arguments.
 * @returns The text, or why it could not be.
 */
export function printf_format(format: string, args: string[]): Formatted {
  const queue: string[] = [...args];
  let text: string = '';
  do {
    const once = format_apply(format, queue);
    if ('refused' in once) return once;
    text += once.text;
    if (once.took === 0) break;
  } while (queue.length > 0);
  return { text };
}

/**
 * `printf FORMAT [ARG]…`: the arguments written under the format.
 *
 * @param args - The format, then its arguments.
 * @returns The text, its line ended.
 */
export async function builtin_printf(args: string[]): Promise<CommandEnvelope> {
  const [format, ...rest] = args;
  if (format === undefined) {
    process.exitCode = 1;
    return envelope_error('', undefined, 'printf: give a format: printf FORMAT [ARG]…\n');
  }
  const formatted: Formatted = printf_format(format, rest);
  if ('refused' in formatted) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${formatted.refused}\n`);
  }
  // A session writes whole lines; there is no prompt to hold a line open for.
  return envelope_ok(formatted.text.endsWith('\n') ? formatted.text : `${formatted.text}\n`);
}
