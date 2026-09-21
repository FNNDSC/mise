/**
 * @file The door's face and its cookie.
 *
 * The login page is the plainest thing that can ask for a name and a
 * password: two fields, one button, and the reason when the last try was
 * refused. The greeter — the brain, the boot rows — comes later and takes
 * this page's place; the form and the route it posts to stay.
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

/**
 * Escapes text for an HTML attribute or body.
 *
 * @param text - The text.
 * @returns The text with `& < > "` escaped.
 */
function html_escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renders the login page.
 *
 * @param cubeUrl - The CUBE this door serves, shown so the operator knows where the password goes.
 * @param reason - Why the last try was refused, when it was.
 * @returns The page.
 */
export function loginPage_render(cubeUrl: string, reason: string | null): string {
  const notice: string = reason === null ? '' : `<p class="reason" role="alert">${html_escape(reason)}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PORTER</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #9cf; font-family: "Share Tech Mono", ui-monospace, monospace; }
  form { display: grid; gap: 0.8rem; width: min(22rem, 90vw); padding: 1.6rem; border-left: 0.6rem solid #1d7bb9; border-radius: 0 1.2rem 1.2rem 0; background: #05121c; }
  h1 { margin: 0 0 0.4rem; font-size: 1.1rem; letter-spacing: 0.2em; color: #66ccff; }
  .cube { font-size: 0.75rem; color: #5a8ca8; overflow-wrap: anywhere; }
  label { display: grid; gap: 0.25rem; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #5a8ca8; }
  input { padding: 0.5rem 0.7rem; border: 1px solid #1d7bb9; border-radius: 0.6rem; background: #000; color: #dff; font: inherit; }
  button { padding: 0.45rem 1.2rem; border: 0; border-radius: 1rem; background: #66ccff; color: #000; font: inherit; font-weight: bold; letter-spacing: 0.1em; cursor: pointer; justify-self: start; }
  button:hover { filter: brightness(1.2); }
  .reason { margin: 0; padding: 0.4rem 0.7rem; border-radius: 0.6rem; background: #3a0a0a; color: #ff9c9c; font-size: 0.85rem; }
</style>
</head>
<body>
<form method="post" action="login">
  <h1>PORTER</h1>
  <div class="cube">${html_escape(cubeUrl)}</div>
  ${notice}
  <label>Username <input name="username" autocomplete="username" required autofocus /></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
  <button type="submit">LOG IN</button>
</form>
</body>
</html>
`;
}
