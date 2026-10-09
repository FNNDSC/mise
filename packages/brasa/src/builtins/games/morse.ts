/**
 * @file `morse`: text to code and back.
 *
 * `morse hello` taps it out; `morse -d .... . .-.. .-.. ---` reads it. One
 * space between letters, a slash between words, as operators write it. The
 * typed model carries the code so a surface with a speaker can sound it.
 *
 * @module
 */
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** The International code. */
export const MORSE: Readonly<Record<string, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.', '\'': '.----.',
};

const MORSE_BACK: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MORSE).map(([letter, code]: [string, string]): [string, string] => [code, letter]),
);

/** Text to code: letters a space apart, words a slash apart; an unknown character is dropped. */
export function morse_encode(text: string): string {
  return text.toUpperCase().trim().split(/\s+/).map((word: string): string =>
    [...word].map((c: string): string => MORSE[c] ?? '').filter((c: string): boolean => c.length > 0).join(' '),
  ).filter((w: string): boolean => w.length > 0).join(' / ');
}

/** Code to text: a group the code does not know becomes `?`. */
export function morse_decode(code: string): string {
  return code.trim().split(/\s*\/\s*|\s{3,}/).map((word: string): string =>
    word.trim().split(/\s+/).filter((g: string): boolean => g.length > 0).map((g: string): string => MORSE_BACK[g] ?? '?').join(''),
  ).join(' ');
}

/** `morse [-d] [text]` */
export async function builtin_morse(args: string[]): Promise<CommandEnvelope> {
  const decode: boolean = args[0] === '-d' || args[0] === '--decode';
  const text: string | null = text_input(decode ? args.slice(1) : args);
  if (text === null) return envelope_error('', undefined, 'morse: usage: morse <text>  |  morse -d <code>\n');
  const said: string = text.replace(/\n$/, '');
  if (decode) {
    const plain: string = morse_decode(said);
    return envelope_ok(`${plain}\n`, { kind: 'games.morse', data: { text: plain, code: said.trim(), direction: 'decode' } });
  }
  const code: string = morse_encode(said);
  if (code === '') return envelope_error('', undefined, 'morse: nothing in that the code can carry\n');
  return envelope_ok(`${code}\n`, { kind: 'games.morse', data: { text: said, code, direction: 'encode' } });
}
