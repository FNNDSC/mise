/**
 * @file The trek bridge, as the host wires it: a program that takes the
 * screen and gives it back.
 *
 * `trek` typed at the transcript console, or asked for by a surface control,
 * opens the bridge over ARGUS and runs the session's `trek` as the operator's
 * own command. While it runs, the command's questions, output and typed
 * events come here instead of the console; when it ends, ARGUS is given back.
 * Esc asks whether to leave; leaving abandons the engine's open question,
 * which the engine reads as end of input and ends the game as the C does.
 *
 * A module of the host, shaped as the GAMES pane's: the host hands in its
 * context and reads the bridge's verbs.
 */
import type { SurfaceAsk } from '../calypso/client.js';
import { TrekBridge } from '../features/trek/bridge.js';
import type { HostContext } from './hostContext.js';

/** The bridge verbs a wired host has. */
export interface TrekBridgeModule {
  /** Opens the bridge over ARGUS and runs the session's `trek` with the line's words; resolves when the game ends. */
  open: (line: string) => Promise<void>;
  /** Whether a bridge is on the screen. */
  active_is: () => boolean;
  /** A question the session put to this surface, while the bridge is up: the bridge answers it. */
  ask: (request: SurfaceAsk) => Promise<string | null>;
  /** A live output chunk, while the bridge is up: the ship's log. */
  output_take: (chunk: string) => void;
  /** A typed event from the running command, while the bridge is up. */
  event_take: (kind: string, data: unknown) => void;
}

/** The words of a `trek` line that never open the bridge: they answer at once in the console. */
const CONSOLE_ONLY_WORDS: ReadonlySet<string> = new Set<string>(['--credits', '--help', '-h', '--version', '-V']);

/**
 * Whether a console line is a game of trek the bridge should take.
 *
 * @param line - The line as typed.
 * @returns True for `trek` and its play options; false for anything else, including `trek --credits`.
 */
export function trekLine_isGame(line: string): boolean {
  const words: string[] = line.trim().split(/\s+/);
  if (words[0] !== 'trek') return false;
  return !words.slice(1).some((word: string): boolean => CONSOLE_ONLY_WORDS.has(word));
}

/**
 * Reads the seed a `trek` line names, for the bridge's block.
 *
 * @param line - The line.
 * @returns The seed, or null when the galaxy is random.
 */
function seed_of(line: string): number | null {
  const words: string[] = line.trim().split(/\s+/);
  const at: number = words.indexOf('--seed');
  if (at < 0) return null;
  const seed: number = Number(words[at + 1]);
  return Number.isFinite(seed) ? seed : null;
}

/**
 * Wires the trek bridge to a host.
 *
 * @param context - The sound and, read when needed, the client.
 * @returns The bridge verbs.
 */
export function trekBridge_wire(context: Pick<HostContext, 'sound' | 'client'>): TrekBridgeModule {
  let bridge: TrekBridge | null = null;
  // What the bridge has heard: for the smoke suite, argus's only executable verification, and for a diagnosis.
  const heard: { events: number; states: number; lastError: string | null } = { events: 0, states: 0, lastError: null };
  (window as unknown as { __argusTrek?: unknown }).__argusTrek = {
    question: (): string | null => bridge?.harness_get().question_get()?.question ?? null,
    prompt: (): string | null => bridge?.harness_get().question_get()?.prompt ?? null,
    readout: (): unknown => bridge?.readout_get() ?? null,
    view: (): string | null => bridge?.view_get() ?? null,
    heard: (): typeof heard => ({ ...heard }),
  };

  const close = (): void => {
    if (bridge === null) return;
    bridge.root.remove();
    bridge = null;
    delete document.body.dataset['takeover'];
  };

  const leave = (): void => {
    if (bridge === null) return;
    bridge.leaveAsk_close();
    // Abandoning the open question is the one way out: the engine reads end of input and ends.
    if (!bridge.harness_get().abandon()) close();
  };

  // Esc, ahead of every other Esc listener (zoom, the gutter, the header): the bridge owns the screen.
  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (bridge === null || event.key !== 'Escape') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (bridge.leaveAsk_isOpen()) bridge.leaveAsk_close();
    else bridge.leave_ask();
  }, true);

  const open = async (line: string): Promise<void> => {
    if (bridge !== null) return;
    const opened: TrekBridge = new TrekBridge({ sound: context.sound, leave }, seed_of(line));
    bridge = opened;
    document.body.append(opened.root);
    document.body.dataset['takeover'] = 'trek';
    context.sound('audio2');
    try {
      // The operator's own command, never instrument traffic: the daemon lets it ask its questions.
      const outcome = await context.client.line_execute(line, { operator: true });
      const ended = outcome.envelopes.find((envelope) => envelope.model?.kind === 'games.trek');
      opened.harness_get().end(typeof (ended?.model?.data as { exit?: number } | undefined)?.exit === 'number' ? (ended?.model?.data as { exit: number }).exit : 0);
    } catch {
      opened.harness_get().end(1);
    } finally {
      if (bridge === opened) close();
    }
  };

  return {
    open,
    active_is: (): boolean => bridge !== null,
    ask: (request: SurfaceAsk): Promise<string | null> => bridge === null ? Promise.resolve(null) : bridge.harness_get().ask(request.message),
    output_take: (chunk: string): void => { bridge?.harness_get().text_take(chunk); },
    event_take: (kind: string, data: unknown): void => {
      heard.events++;
      if (kind === 'games.trek.state') heard.states++;
      try {
        bridge?.harness_get().event_take(kind, data);
      } catch (error: unknown) {
        // A state the bridge cannot draw must not take the game down with it: the engine plays on, the log says why.
        heard.lastError = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
        console.error('trek bridge: could not draw the state', error);
      }
    },
  };
}
