/**
 * @jest-environment jsdom
 *
 * @file A question that stands on a pane stands on the console's line too:
 * whichever answers first wins and the other closes; when the console is
 * already asking, the pane alone asks and the console notes it.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { question_stand } from '../../src/app/asks.js';
import type { ArgusTerminal } from '../../src/console/terminal.js';

/** A console with one question at a time, answered from the test. */
function terminal_make(busy: boolean = false) {
  const log: string[] = [];
  let pending: ((answer: string | null) => void) | null = null;
  const terminal = {
    ask_isOpen: (): boolean => busy || pending !== null,
    ask_open: (request: { message: string; focus?: boolean }): Promise<string | null> => new Promise((resolve) => {
      log.push(`asked ${request.message} focus=${String(request.focus)}`);
      pending = (answer: string | null): void => { pending = null; log.push(`answered ${String(answer)}`); resolve(answer); };
    }),
    ask_settle: (answer: string | null): boolean => { if (pending === null) return false; pending(answer); return true; },
    ask_note: (message: string) => { log.push(`noted ${message}`); return (answer: string | null): void => { log.push(`note ${String(answer)}`); }; },
  };
  return { terminal: terminal as unknown as ArgusTerminal, log, answer: (a: string | null): void => pending?.(a) };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let mount: HTMLElement;
beforeEach((): void => {
  document.body.innerHTML = '<div id="pane"></div>';
  mount = document.getElementById('pane') as HTMLElement;
});

describe('question_stand', () => {
  it('answered on the pane: the console records it and its line is freed, unfocused all along', async () => {
    const { terminal, log } = terminal_make();
    const asked = question_stand(terminal, mount, { message: 'New directory: ', kind: 'text', commit: 'MAKE IT' });
    await tick();
    const field = mount.querySelector<HTMLInputElement>('.ask-bar-field') as HTMLInputElement;
    field.value = 'made';
    (mount.querySelector('.ask-bar-commit') as HTMLButtonElement).click();
    expect(await asked).toBe('made');
    expect(log).toEqual(['asked New directory:  focus=false', 'answered made']);
    expect(terminal.ask_isOpen()).toBe(false);
  });

  it('answered at the console: the pane bar goes', async () => {
    const { terminal, answer } = terminal_make();
    const asked = question_stand(terminal, mount, { message: 'Remove 2 items? ', kind: 'confirm' });
    await tick();
    expect(mount.querySelector('.ask-bar')).not.toBeNull();
    answer('y');
    expect(await asked).toBe('y');
    await tick();
    expect(mount.querySelector('.ask-bar')).toBeNull();
  });

  it('when the console is already asking, the pane alone asks and the console notes it', async () => {
    const { terminal, log } = terminal_make(true);
    const asked = question_stand(terminal, mount, { message: 'Feed title: ', kind: 'text' });
    await tick();
    (mount.querySelector('.ask-bar-field') as HTMLInputElement).value = 't';
    (mount.querySelector('.ask-bar-commit') as HTMLButtonElement).click();
    expect(await asked).toBe('t');
    expect(log).toEqual(['noted Feed title: ', 'note t']);
  });
});
