import {
  clientMessage_parse,
  serverMessage_parse,
  clientMessage_fromJson,
  attach_parse,
} from '../src/protocol/validate';
import { CONTRACT_VERSION } from '../src/protocol/version';

describe('clientMessage_parse', () => {
  it('accepts each client message shape', () => {
    expect(clientMessage_parse({ type: 'attach', protocolVersion: CONTRACT_VERSION, token: 't' }).ok).toBe(true);
    expect(clientMessage_parse({ type: 'execute', id: '1', line: 'ls' }).ok).toBe(true);
    expect(clientMessage_parse({ type: 'complete', id: '2', prefix: 'l' }).ok).toBe(true);
  });

  it('rejects an unknown message type with a reason', () => {
    const r = clientMessage_parse({ type: 'nope', id: '1' });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('rejects a message missing a required field, naming the path', () => {
    const r = clientMessage_parse({ type: 'execute', id: '1' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('line');
  });

  it('tolerates an unknown additive field', () => {
    const r = clientMessage_parse({ type: 'execute', id: '1', line: 'ls', extra: true });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ type: 'execute', id: '1', line: 'ls' });
  });

  it('rejects a non-object input with a reason', () => {
    const r = clientMessage_parse('not a message');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.error!.length).toBeGreaterThan(0);
  });
});

describe('serverMessage_parse', () => {
  it('accepts a result carrying envelopes', () => {
    const r = serverMessage_parse({
      type: 'result',
      id: '1',
      envelopes: [{ status: 'ok', rendered: 'x' }],
    });
    expect(r.ok).toBe(true);
  });

  it('accepts output, session, complete reply, attached and error', () => {
    expect(serverMessage_parse({ type: 'output', id: '1', channel: 'status', chunk: '...' }).ok).toBe(true);
    expect(serverMessage_parse({ type: 'session', surface: 'cli', envelope: { status: 'ok', rendered: 'x' } }).ok).toBe(true);
    expect(serverMessage_parse({ type: 'complete', id: '2', prefix: 'l', candidates: ['ls'] }).ok).toBe(true);
    expect(serverMessage_parse({ type: 'attached', session: 's', protocolVersion: CONTRACT_VERSION }).ok).toBe(true);
    expect(serverMessage_parse({ type: 'error', reason: 'bad token' }).ok).toBe(true);
  });

  it('rejects an output on an unknown channel', () => {
    expect(serverMessage_parse({ type: 'output', id: '1', channel: 'sideband', chunk: 'x' }).ok).toBe(false);
  });
});

describe('clientMessage_fromJson', () => {
  it('parses valid JSON into a message', () => {
    const r = clientMessage_fromJson(JSON.stringify({ type: 'execute', id: '1', line: 'pwd' }));
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON with a clear reason', () => {
    const r = clientMessage_fromJson('{ not json');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('malformed JSON');
  });
});

describe('attach_parse', () => {
  it('accepts an attach on the current contract version', () => {
    const r = attach_parse({ type: 'attach', protocolVersion: CONTRACT_VERSION, token: 't' });
    expect(r.ok).toBe(true);
  });

  it('refuses an attach on an incompatible version', () => {
    const r = attach_parse({ type: 'attach', protocolVersion: CONTRACT_VERSION + 1, token: 't' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('incompatible contract version');
  });

  it('rejects a structurally invalid attach before the version check', () => {
    const r = attach_parse({ type: 'attach', token: 't' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('protocolVersion');
  });
});
