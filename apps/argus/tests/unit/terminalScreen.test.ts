/**
 * @jest-environment jsdom
 */
/**
 * @file The console as a terminal, with xterm.js stood in for: it opens (or
 * reopens, by the tab's id) a terminal the size of its grid, draws what that
 * terminal prints, sends what is typed, offers a line without running it,
 * says when the shell ended and opens a new one on the next key, and turns
 * the touch row's CTRL into control codes. The console switch shows its
 * capsule only where terminals are offered, reads as its next action, and
 * keeps the device's choice.
 *
 * @module
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

/** xterm.js, as the screen uses it. */
class FakeXterm {
  public static last: FakeXterm | null = null;
  public cols: number = 100;
  public rows: number = 30;
  public written: string[] = [];
  public options: Record<string, unknown>;
  public unicode = { activeVersion: '6' };
  public buffer = { active: { length: 0, getLine: (_row: number): { translateToString: () => string } | undefined => undefined } };
  public dataListener: ((data: string) => void) | null = null;
  public focused: number = 0;
  public resets: number = 0;
  public osc: Map<number, (payload: string) => boolean> = new Map();
  public parser = { registerOscHandler: (code: number, handler: (payload: string) => boolean): void => { this.osc.set(code, handler); } };
  constructor(options: Record<string, unknown>) { this.options = options; FakeXterm.last = this; }
  public loadAddon(): void { /* the addons do nothing here */ }
  public open(): void { /* nothing to draw into */ }
  public onData(listener: (data: string) => void): void { this.dataListener = listener; }
  public lineFeed: (() => void) | null = null;
  public onLineFeed(listener: () => void): void { this.lineFeed = listener; }
  public onResize(): void { /* resizes are the fit's, untested here */ }
  public write(data: string): void { this.written.push(data); }
  public focus(): void { this.focused++; }
  public reset(): void { this.resets++; }
  public dispose(): void { /* nothing held */ }
}
jest.unstable_mockModule('@xterm/xterm', () => ({ Terminal: FakeXterm }));
jest.unstable_mockModule('@xterm/addon-fit', () => ({ FitAddon: class { public fit(): void { /* fitted */ } } }));
jest.unstable_mockModule('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
jest.unstable_mockModule('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
jest.unstable_mockModule('@xterm/xterm/css/xterm.css', () => ({}));

const { TerminalScreen, ctrl_apply, terminalTheme_of, terminalState_parse } = await import('../../src/console/terminalScreen.js');
const { consoleMode_wire } = await import('../../src/app/consoleMode.js');

/** The wire, recording what the screen sends. */
function wire_make(): { open: jest.Mock; input: jest.Mock; resize: jest.Mock } {
  return { open: jest.fn(), input: jest.fn(), resize: jest.fn() };
}

beforeEach((): void => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '';
  (globalThis as unknown as { requestAnimationFrame: (fn: () => void) => number }).requestAnimationFrame = (fn: () => void): number => { fn(); return 1; };
});

describe('the terminal screen', () => {
  it('opens a terminal its grid\'s size, keeps its id for the tab, draws the replay and what follows', () => {
    const wire = wire_make();
    const screen = new TerminalScreen(document.body.appendChild(document.createElement('div')), wire, (): void => undefined);
    expect(wire.open).toHaveBeenCalledWith(100, 30, undefined);
    screen.opened('t1', 'earlier output', undefined);
    expect(sessionStorage.getItem('argus.terminalId')).toBe('t1');
    screen.data('t1', 'more');
    screen.data('other', 'not ours');
    expect(FakeXterm.last?.written).toEqual(['earlier output', 'more']);
    expect(wire.resize).toHaveBeenCalledWith('t1', 100, 30);
  });

  it('reopens the tab\'s terminal by its id', () => {
    sessionStorage.setItem('argus.terminalId', 'kept');
    const wire = wire_make();
    new TerminalScreen(document.body.appendChild(document.createElement('div')), wire, (): void => undefined);
    expect(wire.open).toHaveBeenCalledWith(100, 30, 'kept');
  });

  it('sends what is typed, offers a line unrun, and the touch row\'s CTRL makes a control code', () => {
    const wire = wire_make();
    const mount: HTMLElement = document.body.appendChild(document.createElement('div'));
    const screen = new TerminalScreen(mount, wire, (): void => undefined);
    screen.opened('t1', '', undefined);
    FakeXterm.last?.dataListener?.('l');
    screen.type('s\r');
    screen.offer('pacs query PatientID:');
    const ctrl = [...mount.querySelectorAll<HTMLButtonElement>('.argus-xterm-key')].find((key) => key.textContent === 'CTRL') as HTMLButtonElement;
    ctrl.dispatchEvent(new Event('pointerdown'));
    FakeXterm.last?.dataListener?.('c');
    expect(wire.input.mock.calls).toEqual([['t1', 'l'], ['t1', 's\r'], ['t1', '\u0015pacs query PatientID:'], ['t1', '\u0003']]);
    const esc = [...mount.querySelectorAll<HTMLButtonElement>('.argus-xterm-key')].find((key) => key.textContent === 'ESC') as HTMLButtonElement;
    esc.dispatchEvent(new Event('pointerdown'));
    expect(wire.input).toHaveBeenLastCalledWith('t1', '\u001b');
  });

  it('says when the shell ended, and the next key opens a new terminal', () => {
    const wire = wire_make();
    const screen = new TerminalScreen(document.body.appendChild(document.createElement('div')), wire, (): void => undefined);
    screen.opened('t1', '', undefined);
    screen.exited('t1', 0);
    expect(sessionStorage.getItem('argus.terminalId')).toBeNull();
    expect(FakeXterm.last?.written.at(-1)).toContain("the console's shell exited");
    FakeXterm.last?.dataListener?.('x');
    expect(wire.open).toHaveBeenLastCalledWith(100, 30);
    expect(wire.input).not.toHaveBeenCalled();
  });

  it('a refusal is handed on, and nothing is kept', () => {
    const wire = wire_make();
    const refused: string[] = [];
    const screen = new TerminalScreen(document.body.appendChild(document.createElement('div')), wire, (why: string): void => { refused.push(why); });
    screen.opened('', '', 'this daemon offers no terminals');
    expect(refused).toEqual(['this daemon offers no terminals']);
    expect(sessionStorage.getItem('argus.terminalId')).toBeNull();
  });

  it('reads the chell\'s state marks and hands them on; anything else is ignored', () => {
    const states: string[] = [];
    new TerminalScreen(document.body.appendChild(document.createElement('div')), wire_make(), (): void => undefined, (state: string): void => { states.push(state); });
    const handler = FakeXterm.last?.osc.get(6677) as (payload: string) => boolean;
    expect(handler('state=busy')).toBe(true);
    handler('state=asking');
    handler('state=nonsense');
    handler('state=idle');
    expect(states).toEqual(['busy', 'asking', 'idle']);
    expect(terminalState_parse(' state=idle ')).toBe('idle');
    expect(terminalState_parse('idle')).toBeNull();
  });

  it('a mark counts line feeds, so the lines since it hold while old lines scroll out', () => {
    const screen = new TerminalScreen(document.body.appendChild(document.createElement('div')), wire_make(), (): void => undefined);
    const term = FakeXterm.last as FakeXterm;
    // A full buffer: it keeps three lines however many are written.
    let rows: string[] = ['a', 'b', '$ ls'];
    term.buffer.active = { length: 3, getLine: (row: number) => ({ translateToString: (): string => rows[row] ?? '', isWrapped: false }) } as unknown as typeof term.buffer.active;
    const mark: number = screen.mark();
    term.lineFeed?.(); term.lineFeed?.();
    rows = ['$ ls', 'one', 'two'];
    expect(screen.lines_since(mark)).toEqual(['$ ls', 'one', 'two']);
    expect(screen.lines_since(screen.mark())).toEqual(['two']);
  });

  it('control codes and the theme', () => {
    expect(ctrl_apply('c')).toBe('\u0003');
    expect(ctrl_apply('D')).toBe('\u0004');
    expect(ctrl_apply('1')).toBe('1');
    expect(ctrl_apply('\u001b[A')).toBe('\u001b[A');
    const theme = terminalTheme_of('#ffaa44');
    expect(theme.background).toBe('#000000');
    expect(theme.foreground).toBe('#ffaa44');
    expect(theme.red).toBe('#f24444');
  });
});

describe('the console switch', () => {
  /** The page's console, and what the switch drives. */
  function page_make(): { client: Record<string, jest.Mock>; terminal: Record<string, jest.Mock>; capsule: HTMLButtonElement; container: HTMLElement } {
    document.body.innerHTML = '<div id="terminal"></div><button class="console-mode" hidden>TERMINAL</button>';
    const client = { terminal_open: jest.fn(), terminal_input: jest.fn(), terminal_resize: jest.fn(), mirror_set: jest.fn(), note_send: jest.fn() };
    const terminal = { delegate_set: jest.fn(), line_note: jest.fn(), focus_take: jest.fn() };
    return { client, terminal, capsule: document.querySelector('.console-mode') as HTMLButtonElement, container: document.getElementById('terminal') as HTMLElement };
  }

  it('shows no capsule where no terminal is offered, and the transcript is the console', () => {
    const { client, terminal, capsule } = page_make();
    const control = consoleMode_wire({ client: client as never, terminal: terminal as never, offered: false, screen_set: () => undefined });
    expect(capsule.hidden).toBe(true);
    expect(control.terminal_is()).toBe(false);
  });

  it('switches, reads as its next action, mirrors, and keeps the device\'s choice', () => {
    localStorage.setItem('argus.consoleMode', 'transcript');
    const { client, terminal, capsule, container } = page_make();
    let screen: unknown = null;
    const control = consoleMode_wire({ client: client as never, terminal: terminal as never, offered: true, screen_set: (built) => { screen = built; } });
    expect(capsule.hidden).toBe(false);
    expect(capsule.textContent).toBe('TERMINAL');
    capsule.click();
    expect(control.terminal_is()).toBe(true);
    expect(container.classList.contains('console-terminal')).toBe(true);
    expect(capsule.textContent).toBe('TRANSCRIPT');
    expect(client.mirror_set).toHaveBeenLastCalledWith(true);
    expect(screen).not.toBeNull();
    expect(localStorage.getItem('argus.consoleMode')).toBe('terminal');
    const delegate = terminal.delegate_set.mock.calls.at(-1)?.[0] as { note: (t: string) => void };
    delegate.note('a note');
    expect(client.note_send).toHaveBeenCalledWith('a note');
    expect(document.getElementById('terminal')?.dataset['terminalState']).toBe('busy');
    expect((globalThis as unknown as { __argusConsole: { mode: () => string } }).__argusConsole.mode()).toBe('terminal');
    capsule.click();
    expect(control.terminal_is()).toBe(false);
    expect(terminal.delegate_set).toHaveBeenLastCalledWith(null);
    expect(client.mirror_set).toHaveBeenLastCalledWith(false);
  });

  it('opens as the terminal wherever one is offered, unless the device chose the transcript', () => {
    const { client, terminal } = page_make();
    const control = consoleMode_wire({ client: client as never, terminal: terminal as never, offered: true, screen_set: () => undefined });
    expect(control.terminal_is()).toBe(true);
    expect(client.terminal_open).toHaveBeenCalled();
  });
});
