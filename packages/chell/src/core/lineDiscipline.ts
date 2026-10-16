/**
 * @file The terminal's line discipline: lines typed ahead, and the redraw
 * of whatever the operator was typing into.
 *
 * A real terminal keeps what is typed while a program runs and hands it to
 * whatever reads next. chell does the same. A line typed while a command is
 * in flight waits here, in order. A question the command asks takes the
 * first waiting line as its answer; when the command finishes, the rest run
 * as the next commands. Without this, each such line went to the engine as a
 * command of its own, running beside the one that was about to ask for it.
 *
 * Output that arrives on its own (another surface's command, echoed here)
 * lands above the line being typed. The REPL registers how to redraw that
 * line, prompt or question alike, with what was typed so far.
 *
 * @module
 */

const typedAhead: string[] = [];
let redraw: (() => void) | null = null;
let questionOpen: boolean = false;

/**
 * Keeps a line typed while a command is in flight.
 *
 * @param line - The line.
 */
export function typeahead_push(line: string): void {
  typedAhead.push(line);
}

/**
 * Takes the oldest line typed ahead.
 *
 * @returns The line, or undefined when none waits.
 */
export function typeahead_take(): string | undefined {
  return typedAhead.shift();
}

/** Forgets every line typed ahead (Ctrl-C). */
export function typeahead_clear(): void {
  typedAhead.length = 0;
}

/**
 * How many lines wait.
 *
 * @returns The count.
 */
export function typeahead_count(): number {
  return typedAhead.length;
}

/**
 * Marks whether a question is open (the line being typed is an answer).
 *
 * @param open - True while a question waits for its answer.
 */
export function question_openSet(open: boolean): void {
  questionOpen = open;
}

/**
 * Whether a question is open.
 *
 * @returns True while a question waits for its answer.
 */
export function question_isOpen(): boolean {
  return questionOpen;
}

/**
 * Registers how to redraw the line being typed into.
 *
 * @param fn - The redraw, or null when nothing is drawn (no REPL).
 */
export function lineRedraw_set(fn: (() => void) | null): void {
  redraw = fn;
}

/**
 * Writes output that arrived on its own above the line being typed into,
 * then redraws that line (the prompt or an open question, with what was
 * typed so far).
 *
 * @param text - The output; written as it is.
 * @param write - Where it goes; the terminal by default.
 */
export function output_above(text: string, write: (chunk: string) => void = (chunk: string): void => { process.stdout.write(chunk); }): void {
  if (redraw === null) {
    write(text);
    return;
  }
  // Return to the start of the line being typed and clear it, so the output
  // replaces it rather than following it; the redraw puts it back below.
  write('\r\u001b[2K');
  write(text.endsWith('\n') ? text : `${text}\n`);
  redraw();
}
