/**
 * @file A short-lived cache of what the cloud answered.
 *
 * Resource Search and the Limits API throttle, and a listing a second ago is
 * a listing now; the tree keeps each answer for a short life and asks again
 * when it has aged out (docs/stratus.adoc, D4). The clock is injected so a
 * test can age an entry without waiting.
 *
 * @module
 */

/** One kept answer. */
interface Kept<T> {
  readonly value: T;
  readonly at: number;
}

/** Answers kept by key, each for a fixed life. */
export class AnswerCache {
  private readonly kept: Map<string, Kept<unknown>> = new Map();
  private readonly lifeMs: number;
  private readonly now: () => number;

  /**
   * @param lifeMs - How long an answer stays current.
   * @param now - The clock, in milliseconds.
   */
  constructor(lifeMs: number = 60_000, now: () => number = (): number => Date.now()) {
    this.lifeMs = lifeMs;
    this.now = now;
  }

  /**
   * The kept answer for a key, or the one `ask` gives, kept from now.
   *
   * @param key - What the answer is of.
   * @param ask - How to get it when nothing current is kept.
   * @returns The answer.
   */
  async answer_get<T>(key: string, ask: () => Promise<T>): Promise<T> {
    const found: Kept<unknown> | undefined = this.kept.get(key);
    if (found !== undefined && this.now() - found.at < this.lifeMs) return found.value as T;
    const value: T = await ask();
    this.kept.set(key, { value, at: this.now() });
    return value;
  }

  /** Forgets one answer, or every answer under a key prefix. */
  forget(prefix: string): void {
    for (const key of [...this.kept.keys()]) if (key === prefix || key.startsWith(`${prefix}/`)) this.kept.delete(key);
  }

  /** Forgets everything. */
  clear(): void {
    this.kept.clear();
  }
}
