/**
 * @file Bytes of a CFS file: `file`, `xxd`, `strings`, `sha256sum`, `md5sum`.
 *
 * The way people learn what a file is: by its magic, in hex, by the words
 * in it, by its digest. Each reads the file the way `cat` does, through
 * the session's filesystem, so a path is a CFS path. `xxd` and `strings`
 * are bounded and say what they showed.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import { CommandEnvelope, envelope_ok, envelope_error, errorStack, type Result, type StackMessage } from '@fnndsc/cumin';
import { files_cat, files_catBinary } from '@fnndsc/chili/commands/fs/cat.js';
import chalk from 'chalk';
import { path_resolve, error_stripDebugPrefix } from '../utils.js';

/** Bytes `xxd` shows when not told. */
export const XXD_DEFAULT: number = 256;
/** Strings `strings` shows when not told. */
export const STRINGS_DEFAULT: number = 200;

/** What a file is, by its first bytes. */
export function magic_of(bytes: Buffer, name: string = ''): string {
  const at = (i: number): number => bytes[i] ?? -1;
  const ascii = (from: number, to: number): string => bytes.subarray(from, to).toString('latin1');
  if (bytes.length === 0) return 'empty';
  if (bytes.length > 132 && ascii(128, 132) === 'DICM') return 'DICOM medical image (part 10, with preamble)';
  if (at(0) === 0x1f && at(1) === 0x8b) return /\.nii\.gz$/i.test(name) ? 'gzip compressed data, a NIfTI volume by its name' : 'gzip compressed data';
  if (bytes.length >= 348 && (ascii(344, 348) === 'n+1\0' || ascii(344, 348) === 'ni1\0')) return 'NIfTI-1 neuroimaging volume';
  if (bytes.length >= 8 && ascii(4, 8) === 'n+2\0') return 'NIfTI-2 neuroimaging volume';
  if (ascii(0, 4) === '\x89PNG') return 'PNG image';
  if (at(0) === 0xff && at(1) === 0xd8) return 'JPEG image';
  if (ascii(0, 4) === 'GIF8') return 'GIF image';
  if (ascii(0, 4) === '%PDF') return 'PDF document';
  if (ascii(0, 2) === 'PK') return 'ZIP archive';
  if (ascii(0, 4) === 'MThd') return 'MIDI';
  if (ascii(0, 4) === 'RIFF') return 'RIFF (WAV or AVI)';
  if (ascii(0, 2) === 'BM') return 'BMP image';
  if (ascii(0, 7) === '!<arch>') return 'ar archive';
  if (ascii(0, 4) === '\x7fELF') return 'ELF executable';
  if (ascii(0, 5) === 'ustar' || ascii(257, 262) === 'ustar') return 'tar archive';
  if (at(0) === 0x42 && at(1) === 0x5a && at(2) === 0x68) return 'bzip2 compressed data';
  if (ascii(0, 6) === '\xfd7zXZ\0') return 'xz compressed data';
  const head: Buffer = bytes.subarray(0, 4096);
  let printable: number = 0;
  for (const b of head) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  if (printable / head.length > 0.95) {
    const text: string = head.toString('utf-8');
    if (/^\s*[{[]/.test(text)) return 'JSON text';
    if (/^#!/.test(text)) return `script text (${text.split('\n')[0]?.slice(2).trim() ?? ''})`;
    if (/^\s*<\?xml/i.test(text)) return 'XML text';
    if (/^\s*<(!doctype html|html)/i.test(text)) return 'HTML text';
    const lines: string[] = text.split('\n').slice(0, 5);
    if (lines.length > 1 && lines.every((l: string): boolean => l.split(',').length > 1)) return 'CSV text';
    return head.some((b: number): boolean => b >= 128) ? 'UTF-8 text' : 'ASCII text';
  }
  return 'data';
}

/** The canonical hex dump of some bytes, offsets from `base`. */
export function hexdump_render(bytes: Buffer, base: number = 0): string {
  const lines: string[] = [];
  for (let off: number = 0; off < bytes.length; off += 16) {
    const chunk: Buffer = bytes.subarray(off, off + 16);
    const hex: string[] = [];
    for (let i: number = 0; i < 16; i += 2) {
      const a: number | undefined = chunk[i]; const b: number | undefined = chunk[i + 1];
      hex.push(a === undefined ? '    ' : b === undefined ? `${a.toString(16).padStart(2, '0')}  ` : `${a.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
    }
    const text: string = [...chunk].map((b: number): string => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${(base + off).toString(16).padStart(8, '0')}: ${hex.join(' ')}  ${text}`);
  }
  return lines.join('\n');
}

/** The printable runs of at least `min` characters in some bytes. */
export function strings_find(bytes: Buffer, min: number = 4): string[] {
  const out: string[] = [];
  let run: string = '';
  for (const b of bytes) {
    if (b >= 32 && b < 127) { run += String.fromCharCode(b); continue; }
    if (run.length >= min) out.push(run);
    run = '';
  }
  if (run.length >= min) out.push(run);
  return out;
}

/** Reads a CFS file's bytes, or answers why not. */
async function bytes_read(pathArg: string, name: string): Promise<{ path: string; bytes: Buffer } | { error: CommandEnvelope }> {
  const target: string = await path_resolve(pathArg);
  const result: Result<Buffer> = await files_catBinary(target);
  if (result.ok) return { path: target, bytes: result.value };
  // A projected file (/etc/cube, a /proc log) has words but no bytes of its
  // own: its text is read instead, and the refusal of the first read is
  // dropped — it was a question, not a failure.
  const first: StackMessage | undefined = errorStack.stack_pop();
  const text: Result<string> = await files_cat(target);
  if (text.ok) return { path: target, bytes: Buffer.from(text.value, 'utf-8') };
  const last: StackMessage | undefined = errorStack.stack_pop() ?? first;
  const why: string = last === undefined ? 'cannot read' : error_stripDebugPrefix(last.message);
  return { error: envelope_error('', undefined, `${name}: ${pathArg}: ${why}\n`) };
}

/** Takes `-FLAG N` pairs off the arguments. */
function numberFlags_take(args: string[], flags: string[]): { values: Record<string, number>; rest: string[] } | { refusal: string } {
  const values: Record<string, number> = {};
  const rest: string[] = [];
  for (let i: number = 0; i < args.length; i++) {
    const a: string = args[i] as string;
    if (flags.includes(a)) {
      const n: number = Number(args[i + 1]);
      if (!Number.isInteger(n) || n < 0) return { refusal: `${a} wants a whole number` };
      values[a] = n; i++;
    } else {
      rest.push(a);
    }
  }
  return { values, rest };
}

/** `file <path>...` */
export async function builtin_file(args: string[]): Promise<CommandEnvelope> {
  if (args.length === 0) return envelope_error('', undefined, 'file: usage: file <path>...\n');
  const lines: string[] = [];
  const data: Array<{ path: string; kind: string; bytes: number }> = [];
  for (const arg of args) {
    const read = await bytes_read(arg, 'file');
    if ('error' in read) return read.error;
    const kind: string = magic_of(read.bytes, read.path);
    lines.push(`${arg}: ${kind}${read.bytes.length > 0 ? chalk.gray(`  (${read.bytes.length.toLocaleString('en-US')} bytes)`) : ''}`);
    data.push({ path: read.path, kind, bytes: read.bytes.length });
  }
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.file', data: { files: data } });
}

/** `xxd [-s OFFSET] [-l LENGTH] <path>` */
export async function builtin_xxd(args: string[]): Promise<CommandEnvelope> {
  const parsed = numberFlags_take(args, ['-s', '-l']);
  if ('refusal' in parsed) return envelope_error('', undefined, `xxd: ${parsed.refusal}\n`);
  if (parsed.rest.length !== 1) return envelope_error('', undefined, 'xxd: usage: xxd [-s OFFSET] [-l LENGTH] <path>\n');
  const read = await bytes_read(parsed.rest[0] as string, 'xxd');
  if ('error' in read) return read.error;
  const offset: number = parsed.values['-s'] ?? 0;
  const length: number = parsed.values['-l'] ?? XXD_DEFAULT;
  const shown: Buffer = read.bytes.subarray(offset, offset + length);
  const more: number = read.bytes.length - offset - shown.length;
  const note: string = more > 0 ? chalk.gray(`\nxxd: ${shown.length} of ${read.bytes.length.toLocaleString('en-US')} bytes shown (-l ${length}; -s to start elsewhere)`) : '';
  return envelope_ok(`${hexdump_render(shown, offset)}${note}\n`, { kind: 'games.xxd', data: { path: read.path, offset, shown: shown.length, total: read.bytes.length } });
}

/** `strings [-n MIN] [-l LIMIT] <path>` */
export async function builtin_strings(args: string[]): Promise<CommandEnvelope> {
  const parsed = numberFlags_take(args, ['-n', '-l']);
  if ('refusal' in parsed) return envelope_error('', undefined, `strings: ${parsed.refusal}\n`);
  if (parsed.rest.length !== 1) return envelope_error('', undefined, 'strings: usage: strings [-n MIN] [-l LIMIT] <path>\n');
  const read = await bytes_read(parsed.rest[0] as string, 'strings');
  if ('error' in read) return read.error;
  const min: number = Math.max(1, parsed.values['-n'] ?? 4);
  const limit: number = parsed.values['-l'] ?? STRINGS_DEFAULT;
  const found: string[] = strings_find(read.bytes, min);
  const shown: string[] = found.slice(0, limit);
  const note: string = found.length > shown.length ? chalk.gray(`\nstrings: ${shown.length} of ${found.length} shown (-l for more)`) : '';
  return envelope_ok(`${shown.join('\n')}${note}\n`, { kind: 'games.strings', data: { path: read.path, shown: shown.length, total: found.length } });
}

async function digest_run(args: string[], algorithm: 'sha256' | 'md5', name: string): Promise<CommandEnvelope> {
  if (args.length === 0) return envelope_error('', undefined, `${name}: usage: ${name} <path>...\n`);
  const lines: string[] = [];
  const data: Array<{ path: string; digest: string }> = [];
  for (const arg of args) {
    const read = await bytes_read(arg, name);
    if ('error' in read) return read.error;
    const digest: string = createHash(algorithm).update(read.bytes).digest('hex');
    lines.push(`${digest}  ${arg}`);
    data.push({ path: read.path, digest });
  }
  return envelope_ok(`${lines.join('\n')}\n`, { kind: `games.${name}`, data: { algorithm, files: data } });
}

/** `sha256sum <path>...` */
export async function builtin_sha256sum(args: string[]): Promise<CommandEnvelope> {
  return digest_run(args, 'sha256', 'sha256sum');
}

/** `md5sum <path>...` */
export async function builtin_md5sum(args: string[]): Promise<CommandEnvelope> {
  return digest_run(args, 'md5', 'md5sum');
}
