/**
 * @jest-environment jsdom
 */
/**
 * @file A question can be abandoned from wherever the operator is looking.
 *
 * The defect this exists for: the console's question bound its Escape to the
 * input line alone. An operator who pressed a row's verb, leaving focus on
 * the row, and then thought better of it pressed Escape into nothing. The
 * question stayed open, the kernel command that raised it waited forever on
 * an answer that could no longer be given, and the lane counted the minutes
 * with no way back short of a reload.
 *
 * Abandoning is an answer. These prove the console can give it without the
 * input line's help, and that a command is told either way.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { ArgusTerminal } from '../../src/console/terminal.js';

/** A console in a detached container, with nothing behind it. */
function console_make(): ArgusTerminal {
  const container: HTMLElement = document.createElement('div');
  document.body.appendChild(container);
  return new ArgusTerminal(
    container,
    async (): Promise<void> => undefined,
    async (): Promise<{ completions: string[]; prefix: string }> => ({ completions: [], prefix: '' }),
  );
}

describe('an open question', () => {
  it('is abandoned from anywhere, and the answer is null so the command is told', async () => {
    const terminal: ArgusTerminal = console_make();
    const asked: Promise<string | null> = terminal.ask_open({
      message: 'Remove feed 4460 and everything in it? This cannot be undone ',
      kind: 'confirm',
    });
    expect(terminal.ask_isOpen()).toBe(true);

    // No focus, no input line, no keyboard: the gesture the Esc chain makes.
    expect(terminal.ask_abandon()).toBe(true);

    await expect(asked).resolves.toBeNull();
    expect(terminal.ask_isOpen()).toBe(false);
  });

  it('leaves the console able to ask again, so one abandonment does not deafen it', async () => {
    const terminal: ArgusTerminal = console_make();
    const first: Promise<string | null> = terminal.ask_open({ message: 'first?', kind: 'confirm' });
    terminal.ask_abandon();
    await first;

    const second: Promise<string | null> = terminal.ask_open({ message: 'second?', kind: 'confirm' });
    expect(terminal.ask_isOpen()).toBe(true);
    terminal.ask_abandon();
    await expect(second).resolves.toBeNull();
  });

  it('says in the transcript that it was abandoned, so the scrollback holds the whole exchange', async () => {
    const terminal: ArgusTerminal = console_make();
    const asked: Promise<string | null> = terminal.ask_open({ message: 'remove it?', kind: 'confirm' });
    terminal.ask_abandon();
    await asked;
    expect(document.body.textContent).toContain('abandoned');
  });
});

describe('no open question', () => {
  it('leaves Escape to whatever else wants it', () => {
    const terminal: ArgusTerminal = console_make();
    expect(terminal.ask_isOpen()).toBe(false);
    // False is what lets the Esc chain fall through to a drawer, a zoom, a
    // navigation pop. A question that claimed Escape it had no use for would
    // swallow every retreat on the surface.
    expect(terminal.ask_abandon()).toBe(false);
  });
});
