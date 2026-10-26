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
import { AsyncLocalStorage } from 'node:async_hooks';

/** A slot holding the text piped into a segment, or null when nothing was piped. */
interface PipedText {
  value: string | null;
}

/** The slot outside any pipe segment's scope (a test, a direct call). */
const unscoped: PipedText = { value: null };

/**
 * The slot of the pipe segment running on this async path: two lines that
 * run at once each read their own pipe's input, never the other's (#1273).
 */
const pipedScope: AsyncLocalStorage<PipedText> = new AsyncLocalStorage<PipedText>();

/** The slot for the work running now. */
function piped_slot(): PipedText {
  return pipedScope.getStore() ?? unscoped;
}

/**
 * Runs a pipe segment with the text piped into it, in a slot of its own.
 *
 * @param text - The previous segment's output.
 * @param operation - The segment.
 * @returns What the segment returned.
 */
export async function stdinScope_run<T>(text: string | null, operation: () => Promise<T>): Promise<T> {
  return await pipedScope.run({ value: text }, operation);
}

/**
 * Sets what the next builtin may read; the pipe calls this before a segment
 * and clears it after.
 *
 * @param text - The previous segment's output, or null for none.
 */
export function stdin_set(text: string | null): void {
  piped_slot().value = text;
}

/**
 * Takes the piped text, once.
 *
 * @returns The text, or null when the builtin was not piped into.
 */
export function stdin_take(): string | null {
  const slot: PipedText = piped_slot();
  const text: string | null = slot.value;
  slot.value = null;
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
