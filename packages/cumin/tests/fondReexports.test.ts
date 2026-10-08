/**
 * @file cumin re-exports fond's Result and error stack as the same objects (#987).
 */
import * as fond from '@fnndsc/fond';
import { errorStack, errorStack_configure, errorStack_getAllOfType, Ok, Err, result_isOk, result_isErr } from '../src/index';

describe('cumin re-exports fond', () => {
  it('the error stack is fond\'s one instance, never a copy (a copy would be a second singleton)', () => {
    expect(errorStack).toBe(fond.errorStack);
    expect(errorStack_configure).toBe(fond.errorStack_configure);
    expect(errorStack_getAllOfType).toBe(fond.errorStack_getAllOfType);
    errorStack.stack_clear();
    errorStack.stack_push('error', 'pushed through cumin');
    expect(fond.errorStack.stack_pop()?.message).toContain('pushed through cumin');
  });

  it('Result\'s functions are fond\'s', () => {
    expect(Ok).toBe(fond.Ok);
    expect(Err).toBe(fond.Err);
    expect(result_isOk).toBe(fond.result_isOk);
    expect(result_isErr).toBe(fond.result_isErr);
  });
});
