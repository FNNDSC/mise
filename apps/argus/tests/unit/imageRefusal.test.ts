/**
 * @jest-environment jsdom
 */
/**
 * @file A refused slice asks the byte route why and reads the answer out.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { refusal_explain } from '../../src/features/image/refusal.js';

const answer = (status: number, body: string): void => {
  (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => ({ ok: status >= 200 && status < 300, status, text: async (): Promise<string> => body });
};

describe('refusal_explain', () => {
  const original: unknown = (globalThis as { fetch: unknown }).fetch;
  afterEach((): void => { (globalThis as { fetch: unknown }).fetch = original; });

  it('reads the route\'s line in capitals with its status, from a wadouri id with a frame', async () => {
    answer(403, 'not yours to read: CUBE refused the bytes (403)\n');
    expect(await refusal_explain('wadouri:http://h/vfs?path=%2Fa&token=t&frame=3')).toBe('NOT YOURS TO READ: CUBE REFUSED THE BYTES (403)');
  });

  it('says what a 404 and a 502 said', async () => {
    answer(404, 'no such file in CUBE (404)');
    expect(await refusal_explain('http://h/vfs?path=%2Fa')).toBe('NO SUCH FILE IN CUBE (404)');
    answer(502, 'CUBE could not serve it (500)');
    expect(await refusal_explain('http://h/vfs?path=%2Fa')).toBe('CUBE COULD NOT SERVE IT (500) (502)');
  });

  it('names an undecodable file when the route answers 200, and a route that does not answer', async () => {
    answer(200, 'bytes');
    expect(await refusal_explain('http://h/vfs?path=%2Fa')).toBe('COULD NOT BE DECODED');
    (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => { throw new Error('down'); };
    expect(await refusal_explain('http://h/vfs?path=%2Fa')).toBe('COULD NOT BE READ');
  });
});
