/**
 * @file The harness: the player at the keyboard the engine thinks it has.
 *
 * The engine runs in the session as the operator's own `trek` command and
 * asks its questions one at a time; the harness holds the question that is
 * open, names it, and answers it with the line the bridge's controls built.
 * It never predicts the dialogue: it answers the prompt in front of it. The
 * setup questions a typist would answer by hand (press return, a password)
 * it answers itself, keeping the password for the self-destruct check.
 *
 * Pure of DOM: the bridge draws from what the harness reports.
 *
 * @module
 */
import type { TrekState } from 'bsd-trek/host';
import { question_classify, type BridgeCommand, type TrekQuestion } from './model.js';

/** A question the engine is waiting on. */
export interface OpenQuestion {
  /** The prompt as the engine sent it. */
  prompt: string;
  /** The question's name. */
  question: TrekQuestion;
  /** The command the bridge sent last, whose question this is; null during setup or at the Command: prompt. */
  command: BridgeCommand | null;
}

/** What the harness tells the bridge. */
export interface HarnessHooks {
  /** The open question changed: one is waiting, or none (null) while the engine runs. */
  question_changed: (open: OpenQuestion | null) => void;
  /** The engine printed text: the ship's log. */
  text_written: (text: string) => void;
  /** The engine showed its state, before a Command: prompt. */
  state_shown: (state: TrekState) => void;
  /** The game ended, with the command's exit code. */
  ended: (code: number) => void;
}

/** Answers the open question, or abandons it with null. */
type Answer = (line: string | null) => void;

/**
 * Makes a password for the setup question, kept for the self-destruct check.
 *
 * The C asks for one of up to fourteen characters and compares it at `destruct`; what it is does not matter to the player of a bridge, only that both answers agree.
 *
 * @returns The password.
 */
function password_make(): string {
  return `argus${Math.floor(Math.random() * 9000 + 1000)}`;
}

/**
 * The player the engine talks to.
 */
export class TrekHarness {
  private open: { question: OpenQuestion; answer: Answer } | null = null;
  private lastCommand: BridgeCommand | null = null;
  private readonly password: string = password_make();
  private ended: boolean = false;

  /**
   * Makes a harness that reports to a bridge.
   *
   * @param hooks - Where the harness reports.
   */
  constructor(private readonly hooks: HarnessHooks) {}

  /**
   * The engine asks a question: names it, answers the setup ones itself, and holds the rest open for the bridge.
   *
   * @param prompt - The prompt as the engine sent it.
   * @returns The answer, once the bridge gives one; null when abandoned.
   */
  public ask(prompt: string): Promise<string | null> {
    const question: TrekQuestion = question_classify(prompt);
    if (question === 'return') return Promise.resolve('');
    if (question === 'password' || question === 'tournament' || question === 'password-verify') return Promise.resolve(this.password);
    if (question === 'command') this.lastCommand = null;
    return new Promise((resolve: Answer): void => {
      this.open = { question: { prompt, question, command: this.lastCommand }, answer: resolve };
      this.hooks.question_changed(this.open.question);
    });
  }

  /**
   * The question the engine is waiting on, or null while it runs.
   *
   * @returns The open question.
   */
  public question_get(): OpenQuestion | null {
    return this.open?.question ?? null;
  }

  /**
   * Answers the open question with a line, as a typist would.
   *
   * @param line - The line.
   * @returns True when a question was open to answer.
   */
  public answer(line: string): boolean {
    if (this.open === null) return false;
    const { answer } = this.open;
    this.open = null;
    this.hooks.question_changed(null);
    answer(line);
    return true;
  }

  /**
   * Sends a command at the Command: prompt and remembers it, so the questions that follow are known to be its.
   *
   * @param command - The command.
   * @returns True when the Command: prompt was open.
   */
  public command_send(command: BridgeCommand): boolean {
    if (this.open?.question.question !== 'command') return false;
    this.lastCommand = command;
    return this.answer(command.line);
  }

  /**
   * Abandons the open question: the engine reads end of input and ends the game as the C does.
   *
   * @returns True when a question was open to abandon.
   */
  public abandon(): boolean {
    if (this.open === null) return false;
    const { answer } = this.open;
    this.open = null;
    this.hooks.question_changed(null);
    answer(null);
    return true;
  }

  /**
   * The engine printed text.
   *
   * @param text - The text.
   */
  public text_take(text: string): void {
    this.hooks.text_written(text);
  }

  /**
   * A typed event from the command: the state, when it is one.
   *
   * @param kind - What the data is.
   * @param data - The event.
   */
  public event_take(kind: string, data: unknown): void {
    if (kind === 'games.trek.state' && typeof data === 'object' && data !== null) this.hooks.state_shown(data as TrekState);
  }

  /**
   * The command ended.
   *
   * @param code - Its exit code.
   */
  public end(code: number): void {
    if (this.ended) return;
    this.ended = true;
    this.open = null;
    this.hooks.ended(code);
  }

  /**
   * Whether the game has ended.
   *
   * @returns True once the command returned.
   */
  public ended_is(): boolean {
    return this.ended;
  }
}
