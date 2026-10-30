/**
 * @jest-environment jsdom
 */
/**
 * @file The switch between a person's sessions through the porter: the
 * `stratus` and `chris` verbs, the question at the cloud door, and what the
 * page asks the porter.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { argusLine_run, type ArgusHost } from '../../src/console/argusLang.js';
import { session_switch } from '../../src/app/sessionSwitch.js';

/** A host that records each switch it is asked for. */
function host_make(asked: Array<{ to: string; spend: boolean }>): ArgusHost {
  return { session_switch: async (to: 'stratus' | 'chris', spend: boolean): Promise<string> => { asked.push({ to, spend }); return `to ${to}`; } } as unknown as ArgusHost;
}

/** The sheet standing, if one is. */
const sheet = (): HTMLElement | null => document.querySelector('.cloud-ask');

/** Presses the sheet's pill by label. */
function pill_press(label: string): void {
  const button: HTMLButtonElement | undefined = [...document.querySelectorAll<HTMLButtonElement>('.cloud-ask button')].find((one: HTMLButtonElement): boolean => one.textContent === label);
  if (button === undefined) throw new Error(`no ${label} pill`);
  button.click();
}

describe('the stratus and chris verbs', () => {
  it('answers the door in words: read, or manage', async () => {
    const asked: Array<{ to: string; spend: boolean }> = [];
    expect(await argusLine_run(host_make(asked), 'stratus oci read')).toBe('to stratus');
    expect(await argusLine_run(host_make(asked), 'stratus oci manage')).toBe('to stratus');
    expect(await argusLine_run(host_make(asked), 'chris')).toBe('to chris');
    expect(asked).toEqual([{ to: 'stratus', spend: false }, { to: 'stratus', spend: true }, { to: 'chris', spend: false }]);
    expect(sheet()).toBeNull();
  });

  it('asks at the door when nothing is said, and follows the pill pressed', async () => {
    const asked: Array<{ to: string; spend: boolean }> = [];
    const first: Promise<string> = argusLine_run(host_make(asked), 'stratus oci');
    expect(sheet()?.textContent).toContain('CLOUD MANAGEMENT · OCI');
    expect(sheet()?.textContent).toContain('manage   act as well');
    pill_press('MANAGE');
    expect(await first).toBe('to stratus');
    expect(sheet()).toBeNull();
    const second: Promise<string> = argusLine_run(host_make(asked), 'stratus oci');
    pill_press('READ');
    expect(await second).toBe('to stratus');
    const third: Promise<string> = argusLine_run(host_make(asked), 'stratus oci');
    pill_press('NOT NOW');
    expect(await third).toBe('stratus oci: not now; nothing changed');
    expect(asked).toEqual([{ to: 'stratus', spend: true }, { to: 'stratus', spend: false }]);
  });

  it('takes the answer from the keyboard: its first letter, or Escape for not now', async () => {
    const asked: Array<{ to: string; spend: boolean }> = [];
    const first: Promise<string> = argusLine_run(host_make(asked), 'stratus oci');
    sheet()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    expect(await first).toBe('to stratus');
    const second: Promise<string> = argusLine_run(host_make(asked), 'stratus oci');
    sheet()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await second).toContain('not now');
    expect(asked).toEqual([{ to: 'stratus', spend: true }]);
  });

  it('refuses another cloud, an unknown word, two words, and words after chris, by name', async () => {
    const asked: Array<{ to: string; spend: boolean }> = [];
    expect(await argusLine_run(host_make(asked), 'stratus aws')).toBe('stratus: aws: the only cloud is oci');
    expect(await argusLine_run(host_make(asked), 'stratus oci --spend')).toContain('--spend: unknown word');
    expect(await argusLine_run(host_make(asked), 'stratus oci read manage')).toContain('one word');
    expect(await argusLine_run(host_make(asked), 'chris now')).toContain('takes no words');
    expect(asked).toEqual([]);
    expect(sheet()).toBeNull();
  });
});

describe('session_switch', () => {
  beforeEach(() => { window.history.replaceState({}, '', '/s/abcdef0123456789/?door'); });

  it('refuses a page that did not come through a porter', async () => {
    window.history.replaceState({}, '', '/');
    expect(await session_switch('stratus', false)).toContain('did not come through a porter');
  });

  it('says what the porter refused, and asks it for the person\'s cloud session', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = jest.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), body: String(init?.body) });
      return { json: async () => ({ error: 'no OCI credentials are filed for rudolph' }) } as Response;
    }) as unknown as typeof fetch;
    expect(await session_switch('stratus', true)).toBe('stratus: no OCI credentials are filed for rudolph');
    expect(calls).toEqual([{ url: '/switch', body: JSON.stringify({ to: 'stratus', cloud: 'oci', spend: true }) }]);
  });
});
