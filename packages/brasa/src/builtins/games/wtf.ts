/**
 * @file `wtf`: what an acronym means, from the book in `wtf.data.ts`.
 *
 * `wtf is lonk`, `wtf lonk`, `wtf cube pfdcm`. A term the book lacks is
 * said so; `wtf -l` lists every term it has.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import chalk from 'chalk';
import { ACRONYMS } from './wtf.data.js';
import { text_input } from './stdin.js';

/** The meanings of a term, or none. */
export function wtf_lookup(term: string): ReadonlyArray<string> {
  const key: string = term.trim().toLowerCase().replace(/[?.!,]+$/, '');
  return ACRONYMS[key] ?? ACRONYMS[key.replace(/-/g, '')] ?? [];
}

/** `wtf [is] <term>... | wtf -l` */
export async function builtin_wtf(args: string[]): Promise<CommandEnvelope> {
  if (args[0] === '-l' || args[0] === '--list') {
    const terms: string[] = Object.keys(ACRONYMS).sort();
    return envelope_ok(`${terms.join('  ')}\n`, { kind: 'games.wtf', data: { terms } });
  }
  const text: string | null = text_input(args);
  const words: string[] = (text ?? '').trim().split(/\s+/).filter((w: string): boolean => w.length > 0 && !/^(is|are|the|a|an)$/i.test(w));
  if (words.length === 0) return envelope_error('', undefined, 'wtf: usage: wtf [is] <term>   (wtf -l lists the terms)\n');
  const lines: string[] = [];
  const found: Record<string, ReadonlyArray<string>> = {};
  for (const word of words) {
    const meanings: ReadonlyArray<string> = wtf_lookup(word);
    if (meanings.length === 0) {
      lines.push(`${chalk.cyan(word.toUpperCase())}: ${chalk.gray('nothing known. Gee... I don\'t know what that means (wtf -l lists what I do)')}`);
      continue;
    }
    found[word.toLowerCase()] = meanings;
    // A meaning names its term first; the term is lit rather than repeated.
    for (const meaning of meanings) {
      const dash: number = meaning.indexOf(' — ');
      lines.push(dash > 0 ? `${chalk.cyan(meaning.slice(0, dash))} — ${meaning.slice(dash + 3)}` : `${chalk.cyan(word.toUpperCase())}: ${meaning}`);
    }
  }
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.wtf', data: { terms: words, found } });
}
