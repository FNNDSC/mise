/**
 * @file A command's cancellation: Ctrl-C asks a command that declared it can
 * honour it; STOP aborts any command; code inside a stopped command knows.
 */
import { describe, it, expect } from '@jest/globals';
import {
  commandCancellation_abort,
  commandCancellation_active,
  commandCancellation_enable,
  commandCancellation_request,
  commandCancellation_run,
  commandCancellation_signalGet,
  commandCancellation_stopped,
} from '../src/core/cancellation.js';

describe('command cancellation', () => {
  it('Ctrl-C reaches only a command that declared it can honour it', async () => {
    await commandCancellation_run(async (): Promise<void> => {
      expect(commandCancellation_active()).toBe(true);
      expect(commandCancellation_request()).toBe(false);   // not declared
      commandCancellation_enable();
      expect(commandCancellation_request()).toBe(true);
      expect(commandCancellation_signalGet()?.aborted).toBe(true);
    });
    expect(commandCancellation_active()).toBe(false);
  });

  it('STOP aborts any command, and what runs inside it can see that it was stopped', async () => {
    let seen: boolean = false;
    await commandCancellation_run(async (): Promise<void> => {
      expect(commandCancellation_stopped()).toBe(false);
      expect(commandCancellation_abort()).toBe(true);      // undeclared, aborted all the same
      await Promise.resolve();
      seen = commandCancellation_stopped();
      expect(commandCancellation_abort()).toBe(true);      // a second press changes nothing
    });
    expect(seen).toBe(true);
    expect(commandCancellation_stopped()).toBe(false);     // outside any command
    expect(commandCancellation_abort()).toBe(false);       // nothing running
  });

  it('a nested line keeps its parent\'s cancellation', async () => {
    await commandCancellation_run(async (): Promise<void> => {
      const outer: AbortSignal | undefined = commandCancellation_signalGet();
      await commandCancellation_run(async (): Promise<void> => {
        expect(commandCancellation_signalGet()).toBe(outer);
      });
    });
  });
});
