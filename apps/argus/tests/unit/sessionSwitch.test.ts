/**
 * @jest-environment jsdom
 */
/**
 * @file The switch between a person's sessions through the porter: the
 * `stratus` and `chris` verbs, and what the page asks the porter.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { argusLine_run, type ArgusHost } from '../../src/console/argusLang.js';
import { session_switch } from '../../src/app/sessionSwitch.js';

/** A host that records each switch it is asked for. */
function host_make(asked: Array<{ to: string; spend: boolean }>): ArgusHost {
  return { session_switch: async (to: 'stratus' | 'chris', spend: boolean): Promise<string> => { asked.push({ to, spend }); return `to ${to}`; } } as unknown as ArgusHost;
}

describe('the stratus and chris verbs', () => {
  it('asks for the stratus session read-only, or armed once the word is typed', async () => {
    const asked: Array<{ to: string; spend: boolean }> = [];
    expect(await argusLine_run(host_make(asked), 'stratus oci')).toBe('to stratus');
    window.prompt = (): string => 'spend';
    expect(await argusLine_run(host_make(asked), 'stratus oci --spend')).toBe('to stratus');
    window.prompt = (): string => 'no';
    expect(await argusLine_run(host_make(asked), 'stratus oci --spend')).toBe('stratus oci: not armed; nothing changed');
    expect(await argusLine_run(host_make(asked), 'chris')).toBe('to chris');
    expect(asked).toEqual([{ to: 'stratus', spend: false }, { to: 'stratus', spend: true }, { to: 'chris', spend: false }]);
  });

  it('refuses another cloud, an unknown option, and words after chris, by name', async () => {
    const asked: Array<{ to: string; spend: boolean }> = [];
    expect(await argusLine_run(host_make(asked), 'stratus aws')).toBe('stratus: aws: the only cloud is oci');
    expect(await argusLine_run(host_make(asked), 'stratus oci --now')).toContain('--now: unknown option');
    expect(await argusLine_run(host_make(asked), 'stratus oci --spend --read')).toContain('opposite');
    expect(await argusLine_run(host_make(asked), 'chris now')).toContain('takes no words');
    expect(asked).toEqual([]);
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
