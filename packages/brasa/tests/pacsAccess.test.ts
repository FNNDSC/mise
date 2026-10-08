/**
 * @file A PACS refusal is named, and the operator is told where the grant is made.
 */
import { describe, it, expect } from '@jest/globals';
import { pacsRefusal_hint, pacsRefusal_is } from '../src/builtins/net/pacsAccess.js';

describe('a PACS refusal', () => {
  it('is CUBE\'s permission wording or a 403, and nothing else', () => {
    expect(pacsRefusal_is(['Failed to resolve PACS server "PACSDCM": You do not have permission to perform this action.'])).toBe(true);
    expect(pacsRefusal_is(['Request failed with status code 403'])).toBe(true);
    expect(pacsRefusal_is(['No PACS server found for "X".', 'query: Timed out waiting for query 7 result.'])).toBe(false);
    expect(pacsRefusal_is([])).toBe(false);
  });

  it('says the group, and that a directory owns it where CUBE takes groups from one', () => {
    const hint: string = pacsRefusal_hint();
    expect(hint).toContain('pacs_users');
    expect(hint).toContain('Authentik');
    expect(hint.endsWith('\n')).toBe(true);
  });
});
