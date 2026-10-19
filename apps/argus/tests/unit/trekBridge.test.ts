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
  const voice = { pill: (label: string): void => { sounds.push(`pill:${label}`); }, cue: (name: string): void => { sounds.push(name); } };
  const bridge: TrekBridge = new TrekBridge({ voice, leave: (): void => { left.push(1); } }, 42);
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
    // heard: the MOVE pill's beep, the scanner at the sector press, SET COURSE's beep, and ENGAGE as warp
    expect(sounds).toEqual(expect.arrayContaining(['pill:MOVE', 'scanner', 'pill:SET COURSE', 'warp']));
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

describe('the station views', () => {
  it('the gutter changes the view: HELM shows the helm large, the body says which view it is, and the BRIDGE parts hide', () => {
    const { bridge, sounds } = bridge_make();
    bridge.harness_get().event_take('games.trek.state', shown[0]);
    (bridge.root.querySelector('[data-view="helm"]') as HTMLButtonElement).click();
    expect(bridge.view_get()).toBe('helm');
    expect((bridge.root.querySelector('.tb-body') as HTMLElement).dataset['view']).toBe('helm');
    expect(bridge.root.querySelector('.tb-view-helm .tb-wheel-face')?.getAttribute('width')).toBe('260');
    expect(sounds).toContain('pill:HELM');
    bridge.root.remove();
  });

  it('a sector pressed sets the distance in quadrants: a sector is a tenth', () => {
    const { bridge } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    const readout = bridge.readout_get();
    const here = readout?.position.sector as { x: number; y: number };
    const target: { x: number; y: number } = { x: here.x, y: here.y === 0 ? 3 : 0 };
    (bridge.root.querySelector(`.tb-sector[data-x="${target.x}"][data-y="${target.y}"]`) as HTMLButtonElement).click();
    const slider: HTMLInputElement = bridge.root.querySelector('#tb-distance') as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(Math.abs(here.y - target.y) / 10, 5);
    // the helm view's slider follows
    expect(Number((bridge.root.querySelector('#tbh-distance') as HTMLInputElement).value)).toBeCloseTo(Math.abs(here.y - target.y) / 10, 5);
    bridge.root.remove();
  });

  it("the computer's SCORE pill sends c at Command: and answers Request: itself; WARP COST answers the distance and warp factor from its sliders", async () => {
    const { bridge } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    const command: Promise<string | null> = harness.ask('\nCommand: ');
    (bridge.root.querySelector('[data-request="s"]') as HTMLButtonElement).click();
    expect(await command).toBe('c');
    const request: Promise<string | null> = harness.ask('\nRequest: ');
    expect(await request).toBe('s');
    harness.text_take('*** Your score:\n');
    expect(bridge.root.querySelector('.tb-computer-answer')?.textContent).toContain('Your score');
    // the next request, already at Request:
    const again: Promise<string | null> = harness.ask('\nCommand: ');
    (bridge.root.querySelector('[data-request="w"]') as HTMLButtonElement).click();
    expect(await again).toBe('c');
    const request2: Promise<string | null> = harness.ask('\nRequest: ');
    expect(await request2).toBe('w');
    const distance: Promise<string | null> = harness.ask('distance: ');
    expect(Number(await distance)).toBeGreaterThanOrEqual(0);
    const warp: Promise<string | null> = harness.ask('warp factor: ');
    expect(Number(await warp)).toBeGreaterThanOrEqual(1);
    // the score panel stands on the computer view
    expect(bridge.root.querySelector('.tb-score-total')?.textContent).toBe('TOTAL');
    bridge.root.remove();
  });

  it('ENGINEERING draws every device with its repair times and lights its rest slider at How long', async () => {
    const { bridge } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    (bridge.root.querySelector('[data-view="engineering"]') as HTMLButtonElement).click();
    expect(bridge.root.querySelectorAll('.tb-dc-name').length).toBeGreaterThanOrEqual(14);
    expect(bridge.root.querySelectorAll('.tb-pip').length).toBe(bridge.readout_get()?.ship.torpedoesMax);
    const command: Promise<string | null> = harness.ask('\nCommand: ');
    (bridge.root.querySelector('.tb-station-time [data-command="rest"]') as HTMLButtonElement).click();
    expect(await command).toBe('r');
    const howLong: Promise<string | null> = harness.ask('How long: ');
    const rest: HTMLElement = bridge.root.querySelector('#tbe-rest')?.closest('.tb-slider') as HTMLElement;
    expect(rest.classList.contains('tb-lit')).toBe(true);
    (rest.querySelector('.tb-commit') as HTMLButtonElement).click();
    expect(await howLong).toMatch(/^\d+\.\d$/);
    bridge.root.remove();
  });

  it('TACTICAL: a burst angle draws the wedge on the firing wheel, and a bank of phasers can be set and fired', async () => {
    const { bridge } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    const command: Promise<string | null> = harness.ask('\nCommand: ');
    (bridge.root.querySelector('[data-command="torpedo"]') as HTMLButtonElement).click();
    expect(await command).toBe('t');
    const angle: Promise<string | null> = harness.ask('burst angle: ');
    const tactical: HTMLElement = bridge.root.querySelector('.tb-station-tactical') as HTMLElement;
    (tactical.querySelector('.tb-pillrow.tb-lit .tb-choice[data-line="10"]') as HTMLButtonElement).click();
    expect(await angle).toBe('10');
    expect(tactical.querySelector('.tb-wheel-wedge')?.getAttribute('d')).toMatch(/^M /);
    // manual phasers: a bank's units, course and spread from the controls, then FIRE THE BANKS SET sends the 0 that ends the banks
    const command2: Promise<string | null> = harness.ask('\nCommand: ');
    (bridge.root.querySelector('[data-command="phasers"]') as HTMLButtonElement).click();
    expect(await command2).toBe('p');
    const mode: Promise<string | null> = harness.ask('Manual or automatic: ');
    (tactical.querySelector('.tb-pillrow.tb-lit .tb-choice[data-line="m"]') as HTMLButtonElement).click();
    expect(await mode).toBe('m');
    const units: Promise<string | null> = harness.ask('units: ');
    const unitsSlider: HTMLElement = tactical.querySelector('#tb-units')?.closest('.tb-slider') as HTMLElement;
    expect(unitsSlider.classList.contains('tb-lit')).toBe(true);
    expect(unitsSlider.querySelector('.tb-commit')?.textContent).toBe('SET BANK');
    (unitsSlider.querySelector('.tb-commit') as HTMLButtonElement).click();
    expect(await units).toMatch(/^\d+$/);
    const course: Promise<string | null> = harness.ask('course: ');
    expect(tactical.querySelector('.tb-wheel')?.classList.contains('tb-lit')).toBe(true);
    (tactical.querySelector('.tb-wheel .tb-commit') as HTMLButtonElement).click();
    expect(await course).toMatch(/^\d+$/);
    const spread: Promise<string | null> = harness.ask('spread: ');
    (tactical.querySelector('#tb-spread')?.closest('.tb-slider')?.querySelector('.tb-commit') as HTMLButtonElement).click();
    expect(await spread).toBe('0.50');
    const more: Promise<string | null> = harness.ask('units: ');
    const fire: HTMLButtonElement = tactical.querySelector('.tb-fire') as HTMLButtonElement;
    expect(fire.disabled).toBe(false);
    fire.click();
    expect(await more).toBe('0');
    bridge.root.remove();
  });
});
