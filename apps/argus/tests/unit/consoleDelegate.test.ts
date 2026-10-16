/**
 * @jest-environment jsdom
 */
/**
 * @file The transcript standing behind a terminal console: what this surface
 * runs or says (its echoes, notes, streamed output and results) is handed to
 * the terminal a line at a time, a line rewritten in place as it last stood,
 * a status readout not at all; an offered line, the keyboard and the fit go
 * to the terminal; with the delegate gone the transcript is the console again.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { ArgusTerminal, type ConsoleDelegate } from '../../src/console/terminal.js';

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

/** A delegate that keeps what it is handed. */
function delegate_make(): ConsoleDelegate & { notes: string[]; offers: string[]; focused: number; fitted: number } {
  const kept = { notes: [] as string[], offers: [] as string[], focused: 0, fitted: 0 };
  return Object.assign(kept, {
    note: (text: string): void => { kept.notes.push(text); },
    offer: (line: string): void => { kept.offers.push(line); },
    focus: (): void => { kept.focused++; },
    fit: (): void => { kept.fitted++; },
  });
}

describe('a terminal standing in for the transcript', () => {
  it('is handed this surface\'s echoes, notes, output and results, a line at a time', () => {
    const terminal: ArgusTerminal = console_make();
    const delegate = delegate_make();
    terminal.delegate_set(delegate);
    terminal.line_echo('rm -i "/home/me/report.txt"');
    terminal.output_write('data', 'removing ');
    expect(delegate.notes).toEqual(['\u001b[36m❯\u001b[0m rm -i "/home/me/report.txt"\n']);
    terminal.output_write('data', 'report.txt\nspin 1\rspin 2\n');
    terminal.output_write('status', 'a readout\n');
    terminal.outcome_write({ envelopes: [{ status: 'ok', rendered: 'not streamed\n' }], liveChannels: new Set() });
    terminal.line_note('a note of its own');
    expect(delegate.notes.slice(1)).toEqual(['removing report.txt\nspin 2\n', 'not streamed\n', 'a note of its own\n']);
  });

  it('a failure is handed in red, and an unfinished line when the command ends', () => {
    const terminal: ArgusTerminal = console_make();
    const delegate = delegate_make();
    terminal.delegate_set(delegate);
    terminal.output_write('data', 'no newline yet');
    terminal.outcome_write({ envelopes: [{ status: 'error', rendered: '', renderedErr: 'rm: refused\n' }], liveChannels: new Set(['data']) });
    expect(delegate.notes).toEqual(['no newline yet\n', '\u001b[31mrm: refused\u001b[0m\n']);
  });

  it('takes the offered line, the keyboard and the fit; without it the transcript does', () => {
    const terminal: ArgusTerminal = console_make();
    const delegate = delegate_make();
    terminal.delegate_set(delegate);
    terminal.line_offer('pacs query PatientID:');
    terminal.focus_take();
    terminal.size_fit();
    expect(delegate.offers).toEqual(['pacs query PatientID:']);
    expect(delegate.focused).toBe(1);
    expect(delegate.fitted).toBe(1);
    terminal.delegate_set(null);
    terminal.line_offer('ls');
    terminal.line_note('only the transcript');
    expect(delegate.offers).toEqual(['pacs query PatientID:']);
    expect(delegate.notes).toEqual([]);
  });
});
