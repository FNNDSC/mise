/**
 * @file Why a login failed, said as what it is (#965).
 *
 * Every login failure used to print one text that blamed the credentials:
 * an untrusted TLS certificate, a host that does not resolve, a refused
 * connection and a real "wrong password" all read "check your login
 * credentials carefully", and an operator with the right password went
 * looking for the wrong problem. A failure is classified first, and only
 * CUBE's own refusal blames the credentials.
 *
 * chrisapi turns every failure without a response into "No server
 * response!" and keeps none of the network's error code, so when nothing
 * on the error says what happened, one plain request to the same URL asks
 * the network again — on the failure path only, never on a login that works.
 *
 * Dependency-free (Node's own http/https), so the door can use it too
 * (`@fnndsc/cumin/login-failure`).
 *
 * @module
 */
import * as http from 'node:http';
import * as https from 'node:https';

/** What kind of failure a login met. */
export type LoginFailureKind = 'credentials' | 'tls' | 'network' | 'other';

/** A login failure, classified. */
export interface LoginFailure {
  kind: LoginFailureKind;
  /** The network's or TLS's error code, when one was found. */
  code?: string;
  /** CUBE's HTTP status, when it answered. */
  status?: number;
  /** The most telling message found on the error. */
  message: string;
}

/** Node's and OpenSSL's words for a certificate the client does not trust. */
const TLS_CODES: ReadonlySet<string> = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REVOKED',
  'CERT_SIGNATURE_FAILURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The network's words for a CUBE that cannot be reached. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Messages that say nothing about why (chrisapi's, fetch's). */
const GENERIC_MESSAGES: ReadonlySet<string> = new Set(['No server response!', 'fetch failed', 'Bad server response!']);

/** The kind a code alone decides, or null. */
function kind_ofCode(code: string): LoginFailureKind | null {
  if (TLS_CODES.has(code)) return 'tls';
  if (NETWORK_CODES.has(code)) return 'network';
  return null;
}

/**
 * Classifies a login error from what it carries: CUBE's status (400 or 401
 * on `auth-token/`, 401 or 403 on a token), or a TLS or network code found
 * anywhere down its `cause` chain. Nothing found is `other`.
 *
 * @param error - What the login threw.
 * @returns The failure.
 */
export function loginFailure_classify(error: unknown): LoginFailure {
  let status: number | undefined;
  let code: string | undefined;
  let message: string | undefined;
  let at: unknown = error;
  for (let depth = 0; depth < 6 && at !== null && at !== undefined; depth++) {
    if (typeof at === 'object') {
      const node = at as { code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown; cause?: unknown };
      const found: unknown = node.response?.status ?? node.status;
      if (status === undefined && typeof found === 'number') status = found;
      if (code === undefined && typeof node.code === 'string' && kind_ofCode(node.code) !== null) code = node.code;
      if (message === undefined && typeof node.message === 'string' && !GENERIC_MESSAGES.has(node.message)) message = node.message;
      at = node.cause;
    } else {
      if (message === undefined && typeof at === 'string') message = at;
      break;
    }
  }
  const said: string = message ?? (error instanceof Error ? error.message : String(error));
  if (status !== undefined && [400, 401, 403].includes(status)) return { kind: 'credentials', status, message: said };
  if (code !== undefined) return { kind: kind_ofCode(code) ?? 'other', code, message: said };
  return { kind: 'other', ...(status !== undefined ? { status } : {}), message: said };
}

/**
 * Asks the network about a URL once: the error code a plain GET meets, or
 * null when anything answered (the host is there and its certificate holds).
 *
 * @param url - The URL.
 * @param timeoutMs - How long to wait.
 * @returns The code, or null.
 */
export function urlProbe(url: string, timeoutMs: number = 8000): Promise<string | null> {
  return new Promise((resolve: (code: string | null) => void): void => {
    let settled: boolean = false;
    const settle = (code: string | null): void => { if (!settled) { settled = true; resolve(code); } };
    try {
      const client = url.startsWith('https:') ? https : http;
      // A fresh connection, never a kept-alive one: the question is what a new connection meets.
      const request = client.get(url, { agent: false }, (response: http.IncomingMessage): void => { response.resume(); settle(null); });
      request.setTimeout(timeoutMs, (): void => { request.destroy(); settle('ETIMEDOUT'); });
      request.on('error', (error: NodeJS.ErrnoException): void => settle(typeof error.code === 'string' ? error.code : null));
    } catch {
      settle(null);
    }
  });
}

/**
 * Classifies a login error, asking the network once when the error itself
 * carries neither CUBE's answer nor a code (chrisapi's "No server response!").
 *
 * @param error - What the login threw.
 * @param url - The URL the login went to.
 * @param probe - How the network is asked; {@link urlProbe} by default.
 * @returns The failure.
 */
export async function loginFailure_diagnose(error: unknown, url: string, probe: (url: string) => Promise<string | null> = urlProbe): Promise<LoginFailure> {
  const failure: LoginFailure = loginFailure_classify(error);
  if (failure.kind !== 'other' || failure.status !== undefined) return failure;
  const code: string | null = await probe(url);
  const kind: LoginFailureKind | null = code === null ? null : kind_ofCode(code);
  return kind === null ? failure : { kind, code: code as string, message: failure.message };
}

/** The host of a URL, or the URL when it does not parse. */
function host_of(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * What the operator reads about a login failure: the real cause, and what
 * to do. Only CUBE's own refusal blames the credentials; an untrusted
 * certificate names the CA setting (never a switch that turns checking off).
 *
 * @param failure - The failure.
 * @param url - The CUBE the login went to.
 * @returns The lines.
 */
export function loginFailure_lines(failure: LoginFailure, url: string): string[] {
  switch (failure.kind) {
    case 'tls':
      return [
        `Could not log in to ${url}: the TLS certificate of ${host_of(url)} is not trusted (${failure.code}).`,
        'If this CUBE uses a private CA, give Node that CA and try again:',
        '  NODE_EXTRA_CA_CERTS=/path/to/ca.pem',
      ];
    case 'network':
      return [
        `Could not reach ${url} (${failure.code}).`,
        'Check the URL, and that CUBE is up and reachable from this machine.',
      ];
    case 'credentials':
      return [
        `${url} refused the login (HTTP ${failure.status}): the username or password is not right.`,
        'If your password has special characters, check that your shell passes it as typed.',
      ];
    case 'other':
      return [`Could not log in to ${url}: ${failure.message}`];
  }
}
