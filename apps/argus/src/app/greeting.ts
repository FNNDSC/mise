/**
 * @file The session's greeting, asked once at boot and written beneath the
 * brain, followed by whatever the boot has to say after it.
 *
 * A module of the host: the host hands in the wire, the console and the
 * lines that must stand beneath the greeting rather than above it, scrolled
 * away (a build mismatch's words).
 */
import type { WireEnvelope } from '@fnndsc/menu';
import type { ArgusClient, ExecuteOutcome } from '../calypso/client.js';
import type { ArgusTerminal } from '../console/terminal.js';

/**
 * Asks the session for its greeting and writes it, then the lines after it.
 * An older daemon without `motd`, or a refused ask, leaves the brain alone
 * rather than an error; the lines after are written either way.
 *
 * @param client - The wire.
 * @param terminal - The console.
 * @param surface - The surface's name, for `motd`.
 * @param after - Lines to write once the greeting stands.
 */
export function greeting_ask(client: ArgusClient, terminal: ArgusTerminal, surface: string, after: readonly string[]): void {
  void client.line_execute(`motd ${surface}`, { silent: true, observe: false })
    .then((outcome: ExecuteOutcome): void => {
      const text: string = outcome.envelopes
        .filter((envelope: WireEnvelope): boolean => envelope.status === 'ok')
        .map((envelope: WireEnvelope): string => envelope.rendered)
        .join('')
        .trimEnd();
      if (text.length > 0) terminal.greeting_write(text.split('\n'));
    })
    .catch((): void => undefined)
    .finally((): void => { for (const line of after) terminal.line_note(line); });
}
