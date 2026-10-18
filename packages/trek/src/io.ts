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

/** exit(code): the game is over and the command returns. */
export class TrekExit extends Error {
  /** @param code - The exit status. */
  constructor(public readonly code: number) {
    super(`trek exited ${code}`);
  }
}

/** longjmp(env, 1): back to main's "Another game" question. */
export class TrekReset extends Error {
  constructor() {
    super('trek reset');
  }
}

/** What the terminal is wired to. */
export interface TrekTerminal {
  /** Writes text out (whole lines, or the rest at the end). */
  write(text: string): void;
  /** Asks for a line with a prompt; null at end of input. */
  ask(prompt: string): Promise<string | null>;
  /** Waits a number of seconds (sleep()); a test passes a no-op. */
  sleep(seconds: number): Promise<void>;
}

/** What a scanf read: how many items it matched (EOF at end of input), and the value. */
export interface Scanned<T> {
  count: number;
  value: T;
}

/** End of input, as getchar() returns it. */
export const EOF: number = -1;

/** The terminal the game reads and writes. */
export class TrekIO {
  /** Printed, not yet written out (the tail is the next prompt). */
  private pending: string = '';
  /** Characters typed, not yet read. */
  private input: number[] = [];

  /** @param terminal - What it is wired to. */
  constructor(private readonly terminal: TrekTerminal) {}

  /** printf(format, ...). */
  public printf(format: string, ...args: PrintfArg[]): void {
    this.pending += sprintf(format, ...args);
    this.lines_flush();
  }

  /** putchar(c). */
  public putchar(c: string | number): void {
    this.pending += typeof c === 'number' ? String.fromCharCode(c) : c;
    this.lines_flush();
  }

  /** Writes out every complete line printed; the partial tail waits. */
  private lines_flush(): void {
    const cut: number = this.pending.lastIndexOf('\n');
    if (cut < 0) return;
    this.terminal.write(this.pending.slice(0, cut + 1));
    this.pending = this.pending.slice(cut + 1);
  }

  /** Writes out everything printed, the partial tail too (fflush). */
  public fflush(): void {
    if (this.pending !== '') this.terminal.write(this.pending);
    this.pending = '';
  }

  /** getchar(): the next character typed, asking when none is waiting. */
  public async getchar(): Promise<number> {
    if (this.input.length === 0) {
      const prompt: string = this.pending;
      this.pending = '';
      const line: string | null = await this.terminal.ask(prompt);
      if (line === null) return EOF;
      for (const char of `${line}\n`) this.input.push(char.charCodeAt(0));
    }
    return this.input.shift() as number;
  }

  /** ungetc(c): puts a character back to be read next. */
  public ungetc(c: number): void {
    if (c !== EOF) this.input.unshift(c);
  }

  /** sleep(seconds). */
  public async sleep(seconds: number): Promise<void> {
    this.lines_flush();
    await this.terminal.sleep(seconds);
  }

  /** exit(code). */
  public exit(code: number): never {
    this.fflush();
    throw new TrekExit(code);
  }

  /* ------------------------------------------------- scanf, as trek uses it */

  /** Skips white space, as a scanf numeric conversion does; returns the next character, unread. */
  private async space_skip(): Promise<number> {
    let c: number = await this.getchar();
    while (c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13) c = await this.getchar();
    return c;
  }

  /**
   * scanf("%d"): skips white space and reads an integer.
   *
   * @returns The count (1 read, 0 no match, -1 end of input) and the value.
   */
  public async scanInt(): Promise<Scanned<number>> {
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
   * scanf("%lf"): skips white space and reads a decimal number.
   *
   * @returns The count (1 read, 0 no match, -1 end of input) and the value.
   */
  public async scanDouble(): Promise<Scanned<number>> {
    let c: number = await this.space_skip();
    if (c === EOF) return { count: -1, value: 0 };
    let text: string = '';
    const digit = (x: number): boolean => x >= 48 && x <= 57;
    if (c === 43 || c === 45) { text += String.fromCharCode(c); c = await this.getchar(); }
    while (digit(c)) { text += String.fromCharCode(c); c = await this.getchar(); }
    if (c === 46) { text += '.'; c = await this.getchar(); while (digit(c)) { text += String.fromCharCode(c); c = await this.getchar(); } }
    if (/\d/.test(text) && (c === 101 || c === 69)) {
      const mark: string = text;
      text += 'e';
      c = await this.getchar();
      if (c === 43 || c === 45) { text += String.fromCharCode(c); c = await this.getchar(); }
      if (digit(c)) { while (digit(c)) { text += String.fromCharCode(c); c = await this.getchar(); } } else { text = mark; }
    }
    this.ungetc(c);
    if (!/\d/.test(text)) return { count: 0, value: 0 };
    return { count: 1, value: Number.parseFloat(text) };
  }

  /**
   * scanf("%*[set]"): reads and discards characters in the set (no white
   * space skipped first).
   *
   * @param set - The characters.
   * @returns -1 at end of input before any, else 0.
   */
  public async scanSkip(set: string): Promise<number> {
    let c: number = await this.getchar();
    if (c === EOF) return -1;
    while (c !== EOF && set.includes(String.fromCharCode(c))) c = await this.getchar();
    this.ungetc(c);
    return 0;
  }

  /**
   * scanf("%N[^set]"): reads up to N characters not in the set.
   *
   * @param stop - The characters that end it.
   * @param max - At most this many.
   * @returns The count (1 read, 0 none, -1 end of input) and the text.
   */
  public async scanUntil(stop: string, max: number): Promise<Scanned<string>> {
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
