/**
 * Tests for chili's output seam. The default writer delegates to the process
 * console; chili_capture swaps in a buffering writer and returns the collected
 * text.
 */
import {
  chiliLog,
  chiliErrLog,
  chiliWrite,
  chiliWriter_set,
  chili_capture,
  ChiliWriter,
} from '../src/screen/output';

describe('chili output seam', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('the default writer delegates to the process console', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    chiliLog('hello', 42);
    chiliErrLog('oops');
    chiliWrite('raw');

    expect(logSpy).toHaveBeenCalledWith('hello', 42);
    expect(errSpy).toHaveBeenCalledWith('oops');
    expect(outSpy).toHaveBeenCalledWith('raw');
  });

  it('a captured Buffer write is coerced to text', async () => {
    const captured = await chili_capture(async (): Promise<void> => {
      chiliWrite(Buffer.from('bytes'));
    });
    expect(captured.out).toBe('bytes');
  });

  it('chiliWriter_set installs a writer and returns the previous one', () => {
    const seen: string[] = [];
    const custom: ChiliWriter = {
      log: (...args: unknown[]): void => { seen.push(String(args[0])); },
      errLog: (): void => { /* unused */ },
      write: (): void => { /* unused */ },
    };
    const previous: ChiliWriter = chiliWriter_set(custom);
    chiliLog('routed');
    expect(seen).toEqual(['routed']);
    // Restore and confirm the returned writer is the one now in effect.
    const restored: ChiliWriter = chiliWriter_set(previous);
    expect(restored).toBe(custom);
  });

  it('chili_capture collects both channels with console.log formatting', async () => {
    const captured = await chili_capture(async (): Promise<void> => {
      chiliLog('count:', 3);
      chiliWrite('raw-');
      chiliErrLog('bad');
    });
    expect(captured.out).toBe('count: 3\nraw-');
    expect(captured.err).toBe('bad\n');
  });

  it('chili_capture restores the previous writer even when the work throws', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(
      chili_capture(async (): Promise<void> => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    // The default (console) writer is back in effect.
    chiliLog('after');
    expect(logSpy).toHaveBeenCalledWith('after');
  });
});
