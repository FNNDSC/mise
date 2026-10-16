/**
 * @file A chell run as a browser's terminal finds its terminal's id in
 * CHELL_TERMINAL; anything else (the bare flag older daemons set, nothing)
 * means it is no terminal's.
 */
import { describe, it, expect } from '@jest/globals';

const { terminalId_of } = await import('../src/remote/terminalId.js');

describe('terminalId_of', () => {
  it('reads a terminal id', () => {
    expect(terminalId_of('0123456789abcdef01234567')).toBe('0123456789abcdef01234567');
  });
  it('is no terminal\'s for the old flag, nothing, or anything else', () => {
    expect(terminalId_of('1')).toBeNull();
    expect(terminalId_of(undefined)).toBeNull();
    expect(terminalId_of('; rm -rf ~')).toBeNull();
  });
});
