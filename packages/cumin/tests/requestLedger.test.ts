/**
 * @file The request ledger counts what the kernel asks of CUBE, by family,
 * timed, from Node's own diagnostics channels.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { channel } from 'node:diagnostics_channel';
import { requestFamily_of, requestLedger_start, requestLedger_reset, requestLedger_snapshot, ledger_requestStart, ledger_requestEnd, LEDGER_KEPT } from '../src/net/requestLedger';

describe('requestFamily_of', () => {
  it('names the endpoint below /api/v1 with ids and the query dropped', () => {
    expect(requestFamily_of('/api/v1/filebrowser/search/?path=%2Fhome')).toBe('filebrowser/search');
    expect(requestFamily_of('/api/v1/filebrowser/1805753/children/?limit=100&offset=0')).toBe('filebrowser/:id/children');
    expect(requestFamily_of('/api/v1/plugins/?limit=100&offset=200')).toBe('plugins');
    expect(requestFamily_of('/api/v1/pipelines/sourcefiles/')).toBe('pipelines/sourcefiles');
    expect(requestFamily_of('/api/v1/users/3/')).toBe('users/:id');
    expect(requestFamily_of('/api/v1/')).toBe('root');
    expect(requestFamily_of('http://cube/api/v1/feeds/4599/')).toBe('feeds/:id');
  });
});

describe('the ledger', () => {
  beforeEach(() => { requestLedger_start(); requestLedger_reset(); });

  it('counts a request from the http channel start to its response, by family, with its status', () => {
    const request = { method: 'GET', path: '/api/v1/filebrowser/search/?path=%2F' };
    channel('http.client.request.start').publish({ request });
    channel('http.client.response.finish').publish({ request, response: { statusCode: 200 } });
    const snapshot = requestLedger_snapshot();
    expect(snapshot.total).toBe(1);
    expect(snapshot.families).toEqual([{ family: 'filebrowser/search', count: 1, ms: expect.any(Number) }]);
    expect(snapshot.last[0]).toMatchObject({ method: 'GET', family: 'filebrowser/search', status: 200 });
  });

  it('counts fetch through undici the same way, and a failure as status 0', () => {
    const a = { method: 'GET', path: '/api/v1/plugins/?limit=100' };
    const b = { method: 'POST', path: '/api/v1/userfiles/' };
    channel('undici:request:create').publish({ request: a });
    channel('undici:request:headers').publish({ request: a, response: { statusCode: 200 } });
    channel('undici:request:create').publish({ request: b });
    channel('undici:request:error').publish({ request: b, error: new Error('down') });
    const snapshot = requestLedger_snapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.families.map((f) => [f.family, f.count])).toEqual([['plugins', 1], ['userfiles', 1]]);
    expect(snapshot.last.map((e) => e.status)).toEqual([200, 0]);
  });

  it('orders families most-requested first, keeps the last entries only, and forgets on reset', () => {
    for (let i = 0; i < LEDGER_KEPT + 5; i++) { const r = {}; ledger_requestStart(r, 'GET', i % 3 === 0 ? '/api/v1/feeds/' : '/api/v1/plugins/'); ledger_requestEnd(r, 200); }
    const snapshot = requestLedger_snapshot({ last: 500 });
    expect(snapshot.total).toBe(LEDGER_KEPT + 5);
    expect(snapshot.families[0]?.family).toBe('plugins');
    expect(snapshot.last).toHaveLength(LEDGER_KEPT);
    requestLedger_reset();
    expect(requestLedger_snapshot().total).toBe(0);
    expect(requestLedger_snapshot().last).toHaveLength(0);
  });

  it('ignores an end it never saw begin', () => {
    ledger_requestEnd({}, 200);
    expect(requestLedger_snapshot().total).toBe(0);
  });
});
