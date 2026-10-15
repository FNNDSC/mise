/**
 * @file A download saves the file or says why not — never a broken `vfs`.
 *
 * The browser used to fetch the byte route itself and save whatever came
 * back; a login page or a `not found` landed on disk named after the
 * route. The saver now proves the answer is the file before it saves.
 *
 * @module
 */
import { describe, it, expect, jest } from '@jest/globals';
import { attachmentName_read, downloadAnswer_refusal, browserDownload_save } from '../../src/features/files/download.js';

/** A fetch that answers once with the response given. */
function fetch_answering(response: Response): typeof fetch {
  return (async (): Promise<Response> => response) as typeof fetch;
}

describe('attachmentName_read', () => {
  it('takes the UTF-8 name first, then the quoted one, then the path', () => {
    expect(attachmentName_read(`attachment; filename="r_sum_.csv"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv`, '/x/y.csv')).toBe('résumé.csv');
    expect(attachmentName_read('attachment; filename="a b.csv"', '/x/y.csv')).toBe('a b.csv');
    expect(attachmentName_read(null, '/home/chris/csv/pacs-1.csv')).toBe('pacs-1.csv');
  });

  it('never names a file after the route', () => {
    expect(attachmentName_read('attachment', '/home/chris/a.csv')).toBe('a.csv');
    expect(attachmentName_read(`attachment; filename*=UTF-8''%E0%A4%A`, '/home/chris/a.csv')).toBe('a.csv');
  });
});

describe('downloadAnswer_refusal', () => {
  const file: Response = new Response('a,b\n', { status: 200, headers: { 'content-disposition': 'attachment; filename="a.csv"' } });

  it('takes the file', () => {
    expect(downloadAnswer_refusal(file)).toBeNull();
  });

  it('refuses the daemon\'s not found, a refusal, and an answer that is not an attachment', () => {
    expect(downloadAnswer_refusal(new Response('not found', { status: 404 }))).toMatch(/could not read that file/);
    expect(downloadAnswer_refusal(new Response('', { status: 502 }))).toMatch(/HTTP 502/);
    expect(downloadAnswer_refusal(new Response('<html>', { status: 200 }))).toMatch(/something other than the file/);
  });

  it('refuses a door that sent the page to log in', () => {
    const redirected = { ok: true, status: 200, redirected: true, headers: new Headers({ 'content-disposition': 'attachment' }) };
    expect(downloadAnswer_refusal(redirected)).toMatch(/log in again/);
  });
});

describe('browserDownload_save', () => {
  // The save presses an anchor; there is no page here.
  const pressed: string[] = [];
  (globalThis as { document?: unknown }).document ??= {
    createElement: () => ({ click(this: { href: string }) { pressed.push(this.href); }, remove() {} }),
    body: { append() {} },
  };

  it('probes by HEAD under its id, then fetches the file the probe opened', async () => {
    const asked: Array<{ url: string; method: string }> = [];
    const headers = { 'content-disposition': 'attachment; filename="a.csv"', 'content-length': '4' };
    const fetcher = (async (url: string, init?: RequestInit): Promise<Response> => {
      asked.push({ url, method: init?.method ?? 'GET' });
      return init?.method === 'HEAD' ? new Response(null, { status: 200, headers }) : new Response('a,b\n', { status: 200, headers });
    }) as typeof fetch;
    const created: string[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (): string => { created.push('blob'); return 'blob:x'; };
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    const outcome = await browserDownload_save('vfs?path=%2Fa.csv&download=1', '/a.csv', fetcher, 'dl-test01');
    jest.clearAllTimers();
    jest.useRealTimers();
    expect(outcome).toEqual({ ok: true, name: 'a.csv', bytes: 4, streamed: false });
    expect(asked).toEqual([
      { url: 'vfs?path=%2Fa.csv&download=1&dl=dl-test01&probe=1', method: 'HEAD' },
      { url: 'vfs?path=%2Fa.csv&download=1&dl=dl-test01', method: 'GET' },
    ]);
    expect(created).toEqual(['blob']);
  });

  it('hands a large file to the browser after the probe alone', async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string): Promise<Response> => {
      asked.push(url);
      return new Response(null, { status: 200, headers: { 'content-disposition': 'attachment; filename="big.dcm"', 'content-length': String(3_777_606_216) } });
    }) as typeof fetch;
    const outcome = await browserDownload_save('vfs?path=%2Fbig.dcm&download=1', '/big.dcm', fetcher, 'dl-test02');
    expect(outcome).toEqual({ ok: true, name: 'big.dcm', bytes: 3_777_606_216, streamed: true });
    expect(asked).toHaveLength(1);
    expect(pressed[pressed.length - 1]).toBe('vfs?path=%2Fbig.dcm&download=1&dl=dl-test02');
  });

  it('saves nothing and says why when the answer is not the file', async () => {
    const outcome = await browserDownload_save('vfs?path=%2Fa.csv&download=1', '/a.csv', fetch_answering(new Response('not found', { status: 404 })));
    expect(outcome).toEqual({ ok: false, reason: expect.stringMatching(/nothing was saved/) });
  });

  it('says so when the session does not answer at all', async () => {
    const failing = (async (): Promise<Response> => { throw new Error('network down'); }) as typeof fetch;
    const outcome = await browserDownload_save('vfs?path=%2Fa.csv&download=1', '/a.csv', failing);
    expect(outcome).toEqual({ ok: false, reason: expect.stringMatching(/did not answer \(network down\)/) });
  });
});
