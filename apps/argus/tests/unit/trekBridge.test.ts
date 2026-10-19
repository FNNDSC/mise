/**
 * @jest-environment jsdom
 */
/**
 * @file The bridge draws the state the engine shows and answers the engine
 * through its controls: a pill at the Command: prompt sends the command, the
 * wheel answers Course, the slider answers Distance, and a dimmed control
 * answers nothing.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { trek_play } from 'bsd-trek';
import type { TrekState, TrekTerminal } from 'bsd-trek/host';
import { TrekBridge } from '../../src/features/trek/bridge.js';

const shown: TrekState[] = [];
// jsdom has no structuredClone, which the engine uses to copy the state it shows
if (typeof globalThis.structuredClone !== 'function') (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeAll(async () => {
  const script: string[] = ['', 's', 'n', 'pw', 'srscan', 'terminate', 'n'];
  const terminal: TrekTerminal = {
    text_write: (): void => undefined,
    question_ask: async (): Promise<string | null> => (script.length > 0 ? (script.shift() as string) : null),
    seconds_sleep: async (): Promise<void> => {},
    state_show: (state: TrekState): void => { shown.push(state); },
  };
  await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: false }, { saved: null });
});

/** A bridge on a detached body, with its sounds and leaves recorded. */
function bridge_make(): { bridge: TrekBridge; sounds: string[]; left: number[] } {
  const sounds: string[] = [];
  const left: number[] = [];
  const bridge: TrekBridge = new TrekBridge({ sound: (name: string): void => { sounds.push(name); }, leave: (): void => { left.push(1); } }, 42);
  document.body.append(bridge.root);
  return { bridge, sounds, left };
}

describe('the bridge', () => {
  it('draws the shown state: the condition, the scan with one ship, the chart, the devices', () => {
    const { bridge } = bridge_make();
    bridge.harness_get().event_take('games.trek.state', shown[0]);
    const root: HTMLElement = bridge.root;
    expect(root.querySelector('.tb-condition-name')?.textContent).toMatch(/GREEN|YELLOW|RED|DOCKED/);
    expect(root.querySelectorAll('.tb-sector')).toHaveLength(100);
    expect(root.querySelectorAll('.tb-sector-ship')).toHaveLength(1);
    expect(root.querySelectorAll('.tb-quadrant')).toHaveLength(64);
    expect(root.querySelectorAll('.tb-device').length).toBeGreaterThanOrEqual(14);
    expect(root.querySelector('.tb-seed')?.textContent).toBe('SEED 42');
    root.remove();
  });

  it('a command pill answers the Command: prompt, and the wheel and slider answer Course and Distance', async () => {
    const { bridge, sounds } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    const move: HTMLButtonElement = bridge.root.querySelector<HTMLButtonElement>('[data-command="move"]') as HTMLButtonElement;
    // before the Command: prompt the pills are dimmed and press nothing
    expect(move.disabled).toBe(true);
    const command: Promise<string | null> = harness.ask('\nCommand: ');
    expect(move.disabled).toBe(false);
    move.click();
    expect(await command).toBe('m');
    // Course: the helm's wheel is lit; a sector pressed points it; SET COURSE answers
    const course: Promise<string | null> = harness.ask('Course: ');
    const helmWheel: HTMLElement = bridge.root.querySelector('.tb-station-helm .tb-wheel') as HTMLElement;
    expect(helmWheel.classList.contains('tb-lit')).toBe(true);
    const sector: HTMLButtonElement = bridge.root.querySelector<HTMLButtonElement>('.tb-sector[data-x="0"][data-y="9"]') as HTMLButtonElement;
    sector.click();
    (helmWheel.querySelector('.tb-commit') as HTMLButtonElement).click();
    const courseAnswer: string | null = await course;
    expect(Number(courseAnswer)).toBeGreaterThanOrEqual(0);
    expect(Number(courseAnswer)).toBeLessThan(360);
    // Distance: the slider is lit with the pressed sector's distance; ENGAGE answers it
    const distance: Promise<string | null> = harness.ask('Distance: ');
    const slider: HTMLElement = bridge.root.querySelector('#tb-distance')?.closest('.tb-slider') as HTMLElement;
    expect(slider.classList.contains('tb-lit')).toBe(true);
    const engage: HTMLButtonElement = slider.querySelector('.tb-commit') as HTMLButtonElement;
    expect(engage.textContent).toBe('ENGAGE');
    engage.click();
    const distanceAnswer: string | null = await distance;
    expect(Number(distanceAnswer)).toBeGreaterThan(0);
    expect(sounds).toContain('audio1');
    bridge.root.remove();
  });

  it('a question the engine asks on its own stands on the strip as YES and NO', async () => {
    const { bridge } = bridge_make();
    const harness = bridge.harness_get();
    const asked: Promise<string | null> = harness.ask('Are you sure that is wise: ');
    const strip: HTMLElement = bridge.root.querySelector('.tb-ask') as HTMLElement;
    expect(strip.hidden).toBe(false);
    const pills: HTMLButtonElement[] = [...strip.querySelectorAll<HTMLButtonElement>('.tb-choice')];
    expect(pills.map((p: HTMLButtonElement): string | null => p.textContent)).toEqual(['YES', 'NO']);
    pills[1]?.click();
    expect(await asked).toBe('n');
    expect(strip.hidden).toBe(true);
    bridge.root.remove();
  });

  it('the log keeps the engine\'s words, and LEAVE BRIDGE asks before it leaves', () => {
    const { bridge, left } = bridge_make();
    bridge.harness_get().text_take('Klingon at 1,7 fires 274 units\n');
    bridge.harness_get().text_take('Shields hold.');
    const lines: string[] = [...bridge.root.querySelectorAll('.tb-log-line')].map((l: Element): string => l.textContent ?? '');
    expect(lines).toEqual(['Klingon at 1,7 fires 274 units', 'Shields hold.']);
    (bridge.root.querySelector('.tb-leave') as HTMLButtonElement).click();
    expect(bridge.leaveAsk_isOpen()).toBe(true);
    expect(left).toEqual([]);
    (bridge.root.querySelector('.tb-leave-ask .tb-grave') as HTMLButtonElement).click();
    expect(left).toEqual([1]);
    bridge.root.remove();
  });
});
