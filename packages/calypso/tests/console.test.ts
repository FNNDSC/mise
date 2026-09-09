/**
 * @file The daemon's console output is held while a surface has the
 * terminal, and handed back when it lets go.
 *
 * @module
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { consoleCage_isActive, consoleCage_start, consoleCage_stop } from '../src/daemon/console';

describe('the console cage', () => {
  afterEach(() => {
    consoleCage_stop();
  });

  it('holds what the process writes and hands it back on stop, oldest first', () => {
    const realWrite = process.stdout.write;
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((): boolean => true);
    consoleCage_start();
    expect(consoleCage_isActive()).toBe(true);
    process.stdout.write('[ OK ]    Roster       1 feed moved while away\n');
    process.stderr.write('warning: something\n');
    const held: string[] = consoleCage_stop();
    expect(held).toEqual(['[ OK ]    Roster       1 feed moved while away', 'warning: something']);
    // The terminal's own write is back, and nothing reached it while caged.
    expect(process.stdout.write).toBe(spy.getMockImplementation() === undefined ? realWrite : process.stdout.write);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns nothing when no cage is in place, and starts only once', () => {
    expect(consoleCage_stop()).toEqual([]);
    consoleCage_start();
    consoleCage_start();
    process.stdout.write('one line\n');
    expect(consoleCage_stop()).toEqual(['one line']);
    expect(consoleCage_isActive()).toBe(false);
  });
});
