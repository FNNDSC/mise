/**
 * @file trek's terminal: printf out, a character stream in.
 *
 * The C reads its input a character at a time (getchar, ungetc, scanf),
 * which is what lets a player type ahead — `move 2 45 3` on one line — and
 * what makes it prompt only when the next character is a newline. This is
 * that stream over a surface that answers questions a line at a time: when
 * the stream runs dry, the partial line printed so far (`Command: `) is the
 * question asked, and the answer, with its newline, is what getchar reads.
 *
 * exit() and longjmp() are thrown, as TrekExit and TrekReset, and caught
 * where the C's main() and setjmp() stood. Written for the port.
 *
 * @module
 */
import { sprintf, type PrintfArg } from './printf.js';

/**
 * Thrown by exit(code): the game is over and the command returns.
 *
 * Port: stands in for C's exit().
 */
export class TrekExit extends Error {
  /**
   * Carries the exit status up to main.
   *
   * @param code - The exit status.
   */
  constructor(public readonly code: number) {
    super(`trek exited ${code}`);
  }
}

/**
 * Thrown by longjmp(env, 1): back to main's "Another game" question.
 *
 * Port: stands in for C's longjmp().
 */
export class TrekReset extends Error {
  /**
   * Builds the reset signal.
   */
  constructor() {
    super('trek reset');
  }
}

/** What the terminal is wired to. */
export interface TrekTerminal {
  /**
   * Writes text out (whole lines, or the rest at the end).
   *
   * @param text - The text to write.
   */
  text_write(text: string): void;
  /**
   * Asks for a line with a prompt.
   *
   * @param prompt - The text shown before the line is read.
   * @returns The line typed, without its newline; null at end of input.
   */
  question_ask(prompt: string): Promise<string | null>;
  /**
   * Waits a number of seconds (sleep()); a test passes a no-op.
   *
   * @param seconds - How long to wait.
   */
  seconds_sleep(seconds: number): Promise<void>;
}

/** What a scanf read: how many items it matched (EOF at end of input), and the value. */
export interface Scanned<T> {
  /** Items matched: 1 read, 0 no match, -1 end of input. */
  count: number;
  /** The value read (0 or '' when nothing matched). */
  value: T;
}

/** End of input, as getchar() returns it. */
export const EOF: number = -1;

/**
 * The terminal the game reads and writes.
 *
 * Port: stands in for C's stdio (printf, getchar, scanf and the rest).
 */
export class TrekIO {
  /** Printed, not yet written out (the tail is the next prompt). */
  private pending: string = '';
  /** Characters typed, not yet read. */
  private input: number[] = [];

  /**
   * Wires the game's stdio to a terminal.
   *
   * @param terminal - What it is wired to.
   */
  constructor(private readonly terminal: TrekTerminal) {}

  /**
   * Prints formatted text, writing out each complete line.
   *
   * Port: stands in for C's printf().
   *
   * @param format - The printf format string.
   * @param args - The values, in order.
   */
  public printf(format: string, ...args: PrintfArg[]): void {
    this.pending += sprintf(format, ...args);
    this.lines_flush();
  }

  /**
   * Prints one character.
   *
   * Port: stands in for C's putchar().
   *
   * @param c - The character, as a string or a character code.
   */
  public putchar(c: string | number): void {
    this.pending += typeof c === 'number' ? String.fromCharCode(c) : c;
    this.lines_flush();
  }

  /**
   * Writes out every complete line printed; the partial tail waits.
   */
  private lines_flush(): void {
    const cut: number = this.pending.lastIndexOf('\n');
    if (cut < 0) return;
    this.terminal.text_write(this.pending.slice(0, cut + 1));
    this.pending = this.pending.slice(cut + 1);
  }

  /**
   * Writes out everything printed, the partial tail too.
   *
   * Port: stands in for C's fflush().
   */
  public fflush(): void {
    if (this.pending !== '') this.terminal.text_write(this.pending);
    this.pending = '';
  }

  /**
   * Reads the next character typed, asking for a line when none is waiting.
   *
   * Port: stands in for C's getchar().
   *
   * @returns The character code, or EOF at end of input.
   */
  public async getchar(): Promise<number> {
    if (this.input.length === 0) {
      const prompt: string = this.pending;
      this.pending = '';
      const line: string | null = await this.terminal.question_ask(prompt);
      if (line === null) return EOF;
      for (const char of `${line}\n`) this.input.push(char.charCodeAt(0));
    }
    return this.input.shift() as number;
  }

  /**
   * Puts a character back to be read next.
   *
   * Port: stands in for C's ungetc().
   *
   * @param c - The character code (EOF is ignored).
   */
  public ungetc(c: number): void {
    if (c !== EOF) this.input.unshift(c);
  }

  /**
   * Writes out the complete lines, then waits.
   *
   * Port: stands in for C's sleep().
   *
   * @param seconds - How long to wait.
   */
  public async sleep(seconds: number): Promise<void> {
    this.lines_flush();
    await this.terminal.seconds_sleep(seconds);
  }

  /**
   * Writes out everything printed and ends the game.
   *
   * Port: stands in for C's exit().
   *
   * @param code - The exit status.
   * @returns Never: it throws TrekExit.
   */
  public exit(code: number): never {
    this.fflush();
    throw new TrekExit(code);
  }

  /* ------------------------------------------------- scanf, as trek uses it */

  /**
   * Skips white space, as a scanf numeric conversion does.
   *
   * @returns The next character after the white space, read (the caller puts it back or uses it).
   */
  private async space_skip(): Promise<number> {
    let c: number = await this.getchar();
    while (c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13) c = await this.getchar();
    return c;
  }

  /**
   * Skips white space and reads an integer.
   *
   * Port: stands in for C's scanf("%d").
   *
   * @returns The count (1 read, 0 no match, -1 end of input) and the value.
   */
  public async int_scan(): Promise<Scanned<number>> {
    let c: number = await this.space_skip();
    if (c === EOF) return { count: -1, value: 0 };
    let text: string = '';
    if (c === 43 || c === 45) { text += String.fromCharCode(c); c = await this.getchar(); }
    while (c >= 48 && c <= 57) { text += String.fromCharCode(c); c = await this.getchar(); }
    this.ungetc(c);
    if (!/\d/.test(text)) {
      // Nothing that is a number: the sign (if any) is spent, as glibc spends it.
      return { count: 0, value: 0 };
    }
    return { count: 1, value: Number.parseInt(text, 10) | 0 };
  }

  /**
   * Skips white space and reads a decimal number.
   *
   * Port: stands in for C's scanf("%lf").
   *
   * @returns The count (1 read, 0 no match, -1 end of input) and the value.
   */
  public async double_scan(): Promise<Scanned<number>> {
    let c: number = await this.space_skip();
    if (c === EOF) return { count: -1, value: 0 };
    let text: string = '';
    /**
     * Tests a character code for a decimal digit.
     *
     * Port: stands in for C's isdigit().
     *
     * @param x - The character code.
     * @returns Whether it is 0 .. 9.
     */
    const char_checkIsDigit = (x: number): boolean => x >= 48 && x <= 57;
    if (c === 43 || c === 45) { text += String.fromCharCode(c); c = await this.getchar(); }
    while (char_checkIsDigit(c)) { text += String.fromCharCode(c); c = await this.getchar(); }
    if (c === 46) { text += '.'; c = await this.getchar(); while (char_checkIsDigit(c)) { text += String.fromCharCode(c); c = await this.getchar(); } }
    if (/\d/.test(text) && (c === 101 || c === 69)) {
      const mark: string = text;
      text += 'e';
      c = await this.getchar();
      if (c === 43 || c === 45) { text += String.fromCharCode(c); c = await this.getchar(); }
      if (char_checkIsDigit(c)) { while (char_checkIsDigit(c)) { text += String.fromCharCode(c); c = await this.getchar(); } } else { text = mark; }
    }
    this.ungetc(c);
    if (!/\d/.test(text)) return { count: 0, value: 0 };
    return { count: 1, value: Number.parseFloat(text) };
  }

  /**
   * Reads and discards characters in the set (no white space skipped first).
   *
   * Port: stands in for C's scanf("%*[set]").
   *
   * @param set - The characters.
   * @returns -1 at end of input before any, else 0.
   */
  public async chars_skip(set: string): Promise<number> {
    let c: number = await this.getchar();
    if (c === EOF) return -1;
    while (c !== EOF && set.includes(String.fromCharCode(c))) c = await this.getchar();
    this.ungetc(c);
    return 0;
  }

  /**
   * Reads up to N characters not in the set.
   *
   * Port: stands in for C's scanf("%N[^set]").
   *
   * @param stop - The characters that end it.
   * @param max - At most this many.
   * @returns The count (1 read, 0 none, -1 end of input) and the text.
   */
  public async text_scanUntil(stop: string, max: number): Promise<Scanned<string>> {
    let c: number = await this.getchar();
    if (c === EOF) return { count: -1, value: '' };
    let text: string = '';
    while (c !== EOF && !stop.includes(String.fromCharCode(c)) && text.length < max) {
      text += String.fromCharCode(c);
      c = await this.getchar();
    }
    this.ungetc(c);
    return { count: text.length > 0 ? 1 : 0, value: text };
  }
}
