/**
 * @file Login failures classified by what they carry: CUBE's status, or a TLS or network code down the cause chain (#965).
 */
import { loginFailure_classify, loginFailure_diagnose, loginFailure_lines } from '../src/connect/loginFailure';

describe('loginFailure_classify', () => {
  it('CUBE\'s 400 or 401 on auth-token, and 401 or 403 on a token, are the credentials', () => {
    expect(loginFailure_classify(Object.assign(new Error('Unable to log in'), { response: { status: 400 } })).kind).toBe('credentials');
    expect(loginFailure_classify(Object.assign(new Error('x'), { response: { status: 401 } })).kind).toBe('credentials');
    expect(loginFailure_classify(Object.assign(new Error('x'), { status: 403 })).kind).toBe('credentials');
  });

  it('finds a TLS code on the error or down its cause chain (fetch nests the Node error)', () => {
    expect(loginFailure_classify(Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }))).toMatchObject({ kind: 'tls', code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    const fetchError = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
    expect(loginFailure_classify(fetchError)).toMatchObject({ kind: 'tls', code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' });
    expect(loginFailure_classify({ cause: { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } } }).kind).toBe('tls');
  });

  it('finds a network code', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']) {
      expect(loginFailure_classify(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) }))).toMatchObject({ kind: 'network', code });
    }
  });

  it('anything else is other, with the most telling message', () => {
    expect(loginFailure_classify(new Error('No server response!'))).toMatchObject({ kind: 'other', message: 'No server response!' });
    expect(loginFailure_classify(Object.assign(new Error('Bad gateway'), { response: { status: 502 } }))).toMatchObject({ kind: 'other', status: 502 });
    expect(loginFailure_classify('plain words')).toMatchObject({ kind: 'other', message: 'plain words' });
  });
});

describe('loginFailure_diagnose', () => {
  it('asks the network once when the error carries neither status nor code (chrisapi\'s "No server response!")', async () => {
    const probe = jest.fn(async () => 'SELF_SIGNED_CERT_IN_CHAIN');
    expect(await loginFailure_diagnose(new Error('No server response!'), 'https://cube/api/v1/auth-token/', probe)).toMatchObject({ kind: 'tls', code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the error already says, or CUBE answered; a probe that finds nothing leaves it other', async () => {
    const probe = jest.fn(async () => 'ENOTFOUND');
    await loginFailure_diagnose(Object.assign(new Error('x'), { response: { status: 400 } }), 'u', probe);
    await loginFailure_diagnose(Object.assign(new Error('x'), { response: { status: 502 } }), 'u', probe);
    await loginFailure_diagnose(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), 'u', probe);
    expect(probe).not.toHaveBeenCalled();
    expect((await loginFailure_diagnose(new Error('No server response!'), 'u', async () => null)).kind).toBe('other');
  });
});

describe('loginFailure_lines', () => {
  const url = 'https://cube.apps.example.org/api/v1/';
  it('an untrusted certificate names the host, the code and NODE_EXTRA_CA_CERTS, and never suggests turning checks off', () => {
    const text = loginFailure_lines({ kind: 'tls', code: 'SELF_SIGNED_CERT_IN_CHAIN', message: '' }, url).join('\n');
    expect(text).toContain('cube.apps.example.org');
    expect(text).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(text).toContain('NODE_EXTRA_CA_CERTS');
    expect(text).not.toMatch(/REJECT_UNAUTHORIZED|password/i);
  });

  it('only the credentials kind mentions the password', () => {
    expect(loginFailure_lines({ kind: 'credentials', status: 400, message: '' }, url).join(' ')).toMatch(/password/);
    expect(loginFailure_lines({ kind: 'network', code: 'ECONNREFUSED', message: '' }, url).join(' ')).not.toMatch(/password/);
    expect(loginFailure_lines({ kind: 'other', message: 'boom' }, url)).toEqual([`Could not log in to ${url}: boom`]);
  });
});

describe('url_probe', () => {
  it('is null when something answers, and the code when nothing does', async () => {
    const http = await import('node:http');
    const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port: number = (server.address() as { port: number }).port;
    const { url_probe } = await import('../src/connect/loginFailure');
    expect(await url_probe(`http://127.0.0.1:${port}/api/v1/auth-token/`)).toBeNull();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await url_probe(`http://127.0.0.1:${port}/api/v1/auth-token/`)).toBe('ECONNREFUSED');
  });
});
