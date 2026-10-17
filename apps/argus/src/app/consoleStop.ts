/**
 * @file The console's STOP: a capsule in the console's drawer (the bar
 * carries no machinery), standing only while something of this page's runs,
 * that ends it whatever it is.
 *
 * The console reads busy while a command runs: the transcript as `data-busy`,
 * the terminal as its chell's state mark (`busy`, `asking`, `playing`). The
 * pill stands then and nowhere else, and pressing it sends the daemon a
 * `stop`: the command's signal is aborted (a host process it started is
 * killed), and one that does not end when asked is abandoned, so the session
 * is free again. Ctrl-C in the terminal does the same; the pill is for when
 * the keyboard is not getting through, or the console is closed.
 *
 * @module
 */
import type { ArgusClient } from '../calypso/client.js';

/** The terminal states during which something runs. */
const RUNNING: ReadonlySet<string> = new Set(['busy', 'asking', 'playing']);

/**
 * Wires the STOP pill.
 *
 * @param client - The session client.
 * @param terminalId - The page's terminal, when the console is one.
 */
export function consoleStop_wire(client: ArgusClient, terminalId: () => string | null = (): null => null): void {
  const pill: HTMLButtonElement | null = document.querySelector<HTMLButtonElement>('.console-stop');
  const console_: HTMLElement | null = document.getElementById('terminal');
  if (pill === null || console_ === null) return;
  const show = (): void => {
    const terminal: boolean = console_.classList.contains('console-terminal');
    const running: boolean = terminal
      ? RUNNING.has(console_.dataset['terminalState'] ?? '')
      : console_.dataset['busy'] === 'true';
    pill.hidden = !running;
  };
  new MutationObserver(show).observe(console_, { attributes: true, attributeFilter: ['data-busy', 'data-terminal-state', 'class'] });
  show();
  pill.addEventListener('click', (): void => {
    // A program running in the terminal's pty (`!cmd` under host control)
    // takes Ctrl-C as any shell's child does; the daemon's stop ends the rest.
    const id: string | null = console_.classList.contains('console-terminal') ? terminalId() : null;
    if (id !== null) client.terminal_input(id, '\u0003');
    client.stop_send();
  });
}
