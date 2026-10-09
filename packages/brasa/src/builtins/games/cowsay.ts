/**
 * @file `cowsay`, with the ChRIS brain for a cow.
 *
 * The classic: a speech bubble over a creature. Ours thinks rather than
 * lows — the brain is the mascot, and `fortune | cowsay` is what the shelf
 * is for. `-W N` wraps at N columns; `cowthink` is the same with a thought
 * bubble.
 *
 * @module
 */
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** The brain, as ASCII has long drawn it. */
export const BRAIN: ReadonlyArray<string> = [
  '        _---~~(~~-_.',
  '      _{        )   )',
  '    ,   ) -~~- ( ,-\' )_',
  '   (  `-,_..`., )-- \'_,)',
  '  ( ` _)  (  -~( -_ `,  }',
  '  (_-  _  ~_-~~~~`,  ,\' )',
  '    `~ -^(    __;-,((()))',
  '          ~~~~ {_ -_(())',
  '                 `\\  }',
  '                   { }',
];

/** Default wrap width, as cowsay's. */
export const COWSAY_WIDTH: number = 40;

/** Wraps text at a width, keeping the lines it already had. */
export function text_wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words: string[] = paragraph.split(/\s+/).filter((w: string): boolean => w.length > 0);
    if (words.length === 0) { out.push(''); continue; }
    let line: string = '';
    for (const word of words) {
      if (line.length === 0) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/**
 * Draws the bubble: said (speech) or thought.
 *
 * @param lines - The wrapped lines.
 * @param thought - True for a thought bubble (round sides, `o` trail).
 */
export function bubble_draw(lines: string[], thought: boolean): string[] {
  const width: number = Math.max(1, ...lines.map((l: string): number => l.length));
  const pad = (l: string): string => l.padEnd(width, ' ');
  const top: string = ` ${'_'.repeat(width + 2)}`;
  const bottom: string = ` ${'-'.repeat(width + 2)}`;
  if (thought) return [top, ...lines.map((l: string): string => `( ${pad(l)} )`), bottom];
  if (lines.length === 1) return [top, `< ${pad(lines[0] as string)} >`, bottom];
  return [
    top,
    ...lines.map((l: string, i: number): string => {
      const [left, right]: [string, string] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
      return `${left} ${pad(l)} ${right}`;
    }),
    bottom,
  ];
}

/**
 * The whole picture: the bubble, its trail, the brain.
 *
 * @param text - What the brain says.
 * @param thought - Thought bubble rather than speech.
 * @param width - Wrap width.
 */
export function cowsay_render(text: string, thought: boolean = false, width: number = COWSAY_WIDTH): string {
  const lines: string[] = text_wrap(text, Math.max(8, width));
  const trail: string[] = thought ? ['        o', '         o'] : ['        \\', '         \\'];
  return [...bubble_draw(lines, thought), ...trail, ...BRAIN].join('\n') + '\n';
}

/** Parses `-W N` out of the arguments; the rest is the text. */
function cowsayArgs_parse(args: string[]): { width: number; words: string[] } | { refusal: string } {
  let width: number = COWSAY_WIDTH;
  const words: string[] = [];
  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '-W') {
      const n: number = Number(args[i + 1]);
      if (!Number.isInteger(n) || n < 8) return { refusal: 'cowsay: -W wants a width of 8 or more' };
      width = n; i++;
    } else if (args[i]?.startsWith('-') && (args[i]?.length ?? 0) > 1) {
      return { refusal: `cowsay: unknown flag '${args[i]}' (only -W N)` };
    } else {
      words.push(args[i] as string);
    }
  }
  return { width, words };
}

async function cow_run(args: string[], thought: boolean, name: string): Promise<CommandEnvelope> {
  const parsed = cowsayArgs_parse(args);
  if ('refusal' in parsed) return envelope_error('', undefined, `${parsed.refusal}\n`);
  const text: string | null = text_input(parsed.words);
  if (text === null) return envelope_error('', undefined, `${name}: nothing to say (pipe text in, or give it: fortune | ${name})\n`);
  const said: string = text.replace(/\n$/, '');
  return envelope_ok(cowsay_render(said, thought, parsed.width), { kind: 'games.cowsay', data: { text: said, thought } });
}

/** `cowsay [-W N] [text]` */
export async function builtin_cowsay(args: string[]): Promise<CommandEnvelope> {
  return cow_run(args, false, 'cowsay');
}

/** `cowthink [-W N] [text]` */
export async function builtin_cowthink(args: string[]): Promise<CommandEnvelope> {
  return cow_run(args, true, 'cowthink');
}
