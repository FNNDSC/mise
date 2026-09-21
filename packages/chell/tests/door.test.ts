/**
 * @file A terminal comes through the door: the login, the boot stream, the
 * wire, and the cookie that names the session.
 *
 * @module
 */
import { describe, it, expect, jest } from '@jest/globals';
import { door_normalise, doorWire_build, door_login, doorBoot_follow, bootEvents_read, door_enter, type DoorFetch } from '../src/remote/door.js';

const answer = (status: number, body: unknown, setCookie?: string, text?: string): DoorFetch =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string): string | null => (name === 'set-cookie' ? setCookie ?? null : null) },
    json: async () => body,
    text: async () => text ?? '',
    body: null,
  })) as unknown as DoorFetch;

describe('door_normalise and doorWire_build', () => {
  it('ends the door in a slash and mounts the wire on the socket scheme', () => {
    expect(door_normalise('https://titan.tch.harvard.edu')).toBe('https://titan.tch.harvard.edu/');
    expect(door_normalise('http://127.0.0.1:4180/')).toBe('http://127.0.0.1:4180/');
    expect(doorWire_build('https://titan.tch.harvard.edu', '0123456789abcdef')).toBe('wss://titan.tch.harvard.edu/s/0123456789abcdef/');
    expect(doorWire_build('http://127.0.0.1:4180/', '0123456789abcdef')).toBe('ws://127.0.0.1:4180/s/0123456789abcdef/');
  });
});

describe('door_login', () => {
  it('posts the password once and keeps the cookie', async () => {
    const fetchLike: DoorFetch = answer(200, { key: '0123456789abcdef', mount: '/s/0123456789abcdef/', state: 'starting' }, 'porter_session=abc.sig; Path=/; HttpOnly');
    const entered = await door_login('http://127.0.0.1:4180', 'chris', 'pw', fetchLike);
    expect(entered).toEqual({ key: '0123456789abcdef', state: 'starting', cookie: 'porter_session=abc.sig' });
    const [url, init] = (fetchLike as unknown as jest.Mock).mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('http://127.0.0.1:4180/login');
    expect(JSON.parse(init.body)).toEqual({ username: 'chris', password: 'pw' });
    expect(init.headers.accept).toBe('application/json');
  });

  it('carries the door\'s refusal', async () => {
    expect(await door_login('http://d/', 'chris', 'wrong', answer(401, { error: 'CUBE refused the login' }))).toEqual({ refused: 'CUBE refused the login' });
    expect(await door_login('http://d/', 'chris', 'pw', answer(200, { key: 'x' }))).toEqual({ refused: 'the door answered without a session' });
  });
});

describe('bootEvents_read', () => {
  it('hands over each line and stops at the verdict', () => {
    const seen: string[] = [];
    const stream: string = 'event: line\ndata: {"channel":"out","text":"[ OK ] Connect"}\n\nevent: line\ndata: {"channel":"err","text":"warm"}\n\nevent: ready\ndata: {"reason":null}\n\n';
    expect(bootEvents_read(stream, (t: string): void => { seen.push(t); })).toEqual({ state: 'ready' });
    expect(seen).toEqual(['[ OK ] Connect', 'warm']);
    expect(bootEvents_read('event: failed\ndata: {"reason":"it died"}\n\n', (): void => undefined)).toEqual({ state: 'failed', reason: 'it died' });
    expect(bootEvents_read('', (): void => undefined).state).toBe('failed');
  });

  it('follows the boot with the cookie on the request', async () => {
    const fetchLike: DoorFetch = answer(200, null, undefined, 'event: ready\ndata: {}\n\n');
    const ended = await doorBoot_follow('http://d/', { key: '0123456789abcdef', state: 'starting', cookie: 'porter_session=c' }, (): void => undefined, fetchLike);
    expect(ended).toEqual({ state: 'ready' });
    const [url, init] = (fetchLike as unknown as jest.Mock).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://d/boot/0123456789abcdef');
    expect(init.headers.cookie).toBe('porter_session=c');
  });
});

describe('door_enter', () => {
  it('attaches at once to a session already up, with the cookie as the credential', async () => {
    const fetchLike: DoorFetch = answer(200, { key: '0123456789abcdef', mount: '/s/0123456789abcdef/', state: 'attached' }, 'porter_session=c.s; Path=/');
    const reach = await door_enter('https://titan/', 'chris', 'pw', fetchLike);
    expect(reach).toEqual({ identity: 'chris through the door at https://titan/', url: 'wss://titan/s/0123456789abcdef/', headers: { cookie: 'porter_session=c.s' } });
  });

  it('says why when the door refuses', async () => {
    const said: string[] = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((line: string): void => { said.push(String(line)); });
    expect(await door_enter('https://titan/', 'chris', 'wrong', answer(401, { error: 'CUBE refused the login' }))).toBeNull();
    expect(said[0]).toContain('CUBE refused the login');
    errSpy.mockRestore();
  });
});
