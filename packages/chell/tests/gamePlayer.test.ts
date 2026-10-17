/**
 * @file The terminal's player for the kernel's showpieces and arcade: which
 * answers it plays, and that it gives the terminal back as it found it.
 */
import { describe, it, expect } from '@jest/globals';
import { EventEmitter } from 'events';
import { game_play, gameShow_of, gameTerminal_is, type GameTerminal } from '../src/core/gamePlayer.js';

/** A terminal on paper: what was written, raw mode, keys pressed by hand. */
function terminal_make(): { terminal: GameTerminal; written: string[]; input: EventEmitter & { isRaw: boolean }; press: (name: string, sequence?: string, ctrl?: boolean) => void } {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true, isRaw: false,
    setRawMode(raw: boolean) { input.isRaw = raw; return input; },
    resume() { return input; },
  });
  const written: string[] = [];
  const output = Object.assign(new EventEmitter(), { isTTY: true, columns: 40, rows: 12, write(chunk: string) { written.push(chunk); return true; } });
  const press = (name: string, sequence: string = name, ctrl: boolean = false): void => { input.emit('keypress', sequence, { name, ctrl }); };
  return { terminal: { input: input as unknown as NodeJS.ReadStream, output: output as unknown as NodeJS.WriteStream }, written, input, press };
}

describe('the terminal game player', () => {
  it('plays what the kernel named, but not a show marked for the pane', () => {
    expect(gameShow_of([{ status: 'ok', rendered: '', model: { kind: 'games.show', data: { program: 'cmatrix', args: [], arcade: false, pane: false } } }])).toEqual({ program: 'cmatrix' });
    expect(gameShow_of([{ status: 'ok', rendered: '', model: { kind: 'games.show', data: { program: 'tetris', args: [], arcade: true, pane: true } } }])).toBeNull();
    expect(gameShow_of([{ status: 'ok', rendered: '', model: { kind: 'games.show', data: { program: 'starwars' } } }])).toBeNull();
    expect(gameShow_of([{ status: 'ok', rendered: 'hi' }])).toBeNull();
    expect(gameTerminal_is({ input: { isTTY: false } as NodeJS.ReadStream, output: { isTTY: true } as NodeJS.WriteStream })).toBe(false);
  });

  it('takes the screen and the keys, draws, and gives both back on q', async () => {
    const { terminal, written, input, press } = terminal_make();
    const prompt = (): void => undefined;
    input.on('keypress', prompt);                       // readline, at the prompt
    const played: Promise<void> = game_play({ program: 'snake' }, terminal);
    expect(input.listeners('keypress')).not.toContain(prompt);
    expect(input.isRaw).toBe(true);
    expect(written[0]).toContain('\u001b[?1049h');       // the alternate screen
    expect(written.join('')).toContain('q leaves');
    press('up');                                         // the snake turns; not the prompt's
    press('q');
    await played;
    expect(input.listeners('keypress')).toContain(prompt);
    expect(input.isRaw).toBe(false);
    expect(written.at(-1)).toContain('\u001b[?1049l');   // the screen given back
  });

  it('Esc and Ctrl-C leave too', async () => {
    for (const leave of [['escape', '\u001b', false], ['c', '\u0003', true]] as const) {
      const { terminal, press } = terminal_make();
      const played: Promise<void> = game_play({ program: 'cmatrix' }, terminal);
      press(leave[0], leave[1], leave[2]);
      await expect(played).resolves.toBeUndefined();
    }
  });
});
