/**
 * @file What a piped builtin reads: the text the segment before it wrote.
 *
 * A pipeline's first segment always ran in the kernel; the rest went to the
 * surface's host shell, so `fortune | cowsay` reached the host's cowsay (or,
 * in a browser, nothing). A segment that names a builtin now runs in the
 * kernel too, and reads what came before it here. The slot is set by the
 * pipe for the length of one segment and taken by the builtin that wants
 * it; a builtin that does not read it leaves it to be cleared, as a shell
 * command that ignores stdin does.
 *
 * @module
 */

/** The text piped into the segment now running, or null when nothing was. */
let piped: string | null = null;

/**
 * Sets what the next builtin may read; the pipe calls this before a segment
 * and clears it after.
 *
 * @param text - The previous segment's output, or null for none.
 */
export function stdin_set(text: string | null): void {
  piped = text;
}

/**
 * Takes the piped text, once.
 *
 * @returns The text, or null when the builtin was not piped into.
 */
export function stdin_take(): string | null {
  const text: string | null = piped;
  piped = null;
  return text;
}

/**
 * The text a toy works on: what was piped in, else its arguments joined,
 * else nothing.
 *
 * @param args - The builtin's arguments.
 * @returns The text, or null when there is none either way.
 */
export function text_input(args: ReadonlyArray<string>): string | null {
  const fromPipe: string | null = stdin_take();
  if (fromPipe !== null) return fromPipe;
  return args.length > 0 ? args.join(' ') : null;
}
