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
});
