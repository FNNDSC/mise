/**
 * @file The ChRIS help, registered for a suite as the package entry registers
 * it with the ChRIS commands: a ChRIS builtin's `--help` reads it from the registry.
 */
import { commands_register } from '../../src/core/commandRegistry.js';
import { chrisHelp } from '../../src/chris/help.js';
import { HELP_ORDER } from '../../src/core/commandOrder.js';

/** Registers the ChRIS backend's help pages. */
export function chrisHelp_install(): void {
  commands_register({ help: chrisHelp }, 'backend');
}

/**
 * Registers a stand-in handler for every name with help, so a suite sees a
 * session that has every verb (as a ChRIS session does) without loading the
 * commands themselves.
 */
export function everyVerb_install(): void {
  const ran = async (): Promise<{ status: 'ok'; rendered: string }> => ({ status: 'ok', rendered: '' });
  commands_register({ envelope: Object.fromEntries(HELP_ORDER.map((name: string) => [name.split(' ')[0] as string, ran])) });
}
