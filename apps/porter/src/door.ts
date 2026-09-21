/**
 * @file The door's cookie.
 *
 * The cookie names the session the browser was let into, signed so the
 * browser cannot name another. HttpOnly, so a script in the page cannot read
 * it; SameSite=Lax, so a link from elsewhere carries it but a form from
 * elsewhere does not; Secure when the page came over TLS.
 *
 * @module
 */

/** The cookie the door sets. */
export const DOOR_COOKIE: string = 'porter_session';

/** The cookie's attributes for one deployment. */
export interface DoorCookieOptions {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  signed: true;
  maxAge: number;
}

/**
 * The attributes the door's cookie is set with.
 *
 * @param hours - How long the browser stays let in.
 * @param secure - Whether the page came over TLS.
 * @returns The cookie options.
 */
export function doorCookie_options(hours: number, secure: boolean): DoorCookieOptions {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure, signed: true, maxAge: Math.round(hours * 3600) };
}
