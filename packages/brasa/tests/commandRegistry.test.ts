/**
 * @file The command registry keeps names in registration order, lets a later
 * registration replace an earlier, and answers lookups as the dispatch tables did.
 */
import { describe, it, expect } from '@jest/globals';
import {
  commands_register,
  envelopeHandler_get,
  plainHandler_get,
  builtinCommand_has,
  envelopeCommand_names,
  plainCommand_names,
  commandHelpEntry_get,
  helpTopic_names,
  commandOrder_set,
} from '../src/core/commandRegistry.js';

const envelope = (tag: string) => async () => ({ status: 'ok' as const, rendered: tag });

describe('the command registry', () => {
  it('lists names in the order registered, and a later registration of a name replaces the earlier', async () => {
    const first = envelope('first');
    const second = envelope('second');
    commands_register({ envelope: { 'zz-a': first, 'zz-b': envelope('b') } });
    commands_register({ envelope: { 'zz-a': second } });
    expect(envelopeCommand_names().filter((n: string) => n.startsWith('zz-'))).toEqual(['zz-a', 'zz-b']);
    expect(envelopeHandler_get('zz-a')).toBe(second);
  });

  it('answers envelope and plain handlers separately, and either makes a name a builtin', () => {
    const plain = async (): Promise<void> => undefined;
    commands_register({ plain: { 'zz-plain': plain } });
    expect(plainHandler_get('zz-plain')).toBe(plain);
    expect(envelopeHandler_get('zz-plain')).toBeUndefined();
    expect(plainCommand_names()).toContain('zz-plain');
    expect(builtinCommand_has('zz-plain')).toBe(true);
    expect(builtinCommand_has('zz-b')).toBe(true);
    expect(builtinCommand_has('zz-nothing')).toBe(false);
  });

  it('looks names up as the tables did: a name inherited from Object.prototype counts as a builtin (kept deliberately; changing it is its own decision)', () => {
    expect(builtinCommand_has('toString')).toBe(true);
    expect(typeof plainHandler_get('constructor')).toBe('function');
  });

  it('keeps help by name: its names are the builtins /bin lists and the shell completes, in registration order', () => {
    const help = { usage: 'zz-help [x]', description: 'a test command' };
    commands_register({ help: { 'zz-help': help, 'zz-help2': { usage: 'u', description: 'd' } } });
    expect(commandHelpEntry_get('zz-help')).toBe(help);
    const names: string[] = helpTopic_names().filter((n: string) => n.startsWith('zz-help'));
    expect(names).toEqual(['zz-help', 'zz-help2']);
    expect(commandHelpEntry_get('zz-none')).toBeUndefined();
  });

  it('lists in the order set, apart from which group registered a name; an unlisted name lists after, in registration order', () => {
    commands_register({ help: { 'zz-o-late': { usage: 'u', description: 'd' } } });
    commands_register({ help: { 'zz-o-early': { usage: 'u', description: 'd' }, 'zz-o-new': { usage: 'u', description: 'd' } } });
    commandOrder_set({ help: ['zz-o-early', 'zz-o-late'] });
    const names: string[] = helpTopic_names().filter((n: string) => n.startsWith('zz-o-'));
    expect(names).toEqual(['zz-o-early', 'zz-o-late', 'zz-o-new']);
  });
});

describe('a backend beside the core', () => {
  it('adds its commands, and may not replace one of the core\'s', () => {
    commands_register({ envelope: { corecmd: envelope('core') } });
    commands_register({ envelope: { backendcmd: envelope('backend') } }, 'backend');
    expect(builtinCommand_has('backendcmd')).toBe(true);
    expect(() => commands_register({ envelope: { corecmd: envelope('theirs') }, plain: { corecmd: async () => undefined } }, 'backend'))
      .toThrow("a backend cannot replace the core's commands: corecmd");
  });
});

