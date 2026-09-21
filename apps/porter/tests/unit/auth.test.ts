/**
 * @file The door's one use of a password: CUBE trades it for a token.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { cubeToken_mint, type FetchLike } from '../../src/cube/auth.js';

const answer = (status: number, body: unknown): FetchLike =>
  jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as FetchLike;

describe('cubeToken_mint', () => {
  it('posts the password to auth-token/ and keeps only the token', async () => {
    const fetchLike: FetchLike = answer(200, { token: 'MINTED' });
    const minted = await cubeToken_mint('https://cube/api/v1/', 'chris', 'pw', fetchLike);
    expect(minted).toEqual({ token: 'MINTED' });
    const [url, init] = (fetchLike as unknown as jest.Mock).mock.calls[0] as [string, { body: string; method: string }];
    expect(url).toBe('https://cube/api/v1/auth-token/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ username: 'chris', password: 'pw' });
  });

  it('says CUBE refused on a 400 or 401', async () => {
    expect((await cubeToken_mint('https://cube/api/v1/', 'chris', 'wrong', answer(400, {}))).reason).toBe('CUBE refused the login');
    expect((await cubeToken_mint('https://cube/api/v1/', 'chris', 'wrong', answer(401, {}))).reason).toBe('CUBE refused the login');
  });

  it('reports any other status by number', async () => {
    expect((await cubeToken_mint('https://cube/api/v1/', 'chris', 'pw', answer(503, {}))).reason).toBe('CUBE answered 503');
  });

  it('reports an answer without a token', async () => {
    expect((await cubeToken_mint('https://cube/api/v1/', 'chris', 'pw', answer(200, { detail: 'odd' }))).reason).toBe('CUBE answered without a token');
  });

  it('reports an unreachable CUBE', async () => {
    const down: FetchLike = jest.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as FetchLike;
    expect((await cubeToken_mint('https://cube/api/v1/', 'chris', 'pw', down)).reason).toBe('CUBE unreachable: ECONNREFUSED');
  });
});
