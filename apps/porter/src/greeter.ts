/**
 * @file The greeter: the door's face, before and during a boot.
 *
 * One shell, two acts. At the door the brain rests at its end state beside
 * a name and a password. Once the password is taken the browser is sent to
 * the greet, where the brain wakes — the same frames a terminal boot draws,
 * paced by the page — and the daemon's boot rows arrive beneath it as
 * server-sent events, ANSI and all, rendered the way the console renders a
 * transcript. `ready` hands the browser to the session; `failed` says why
 * and offers the door again.
 *
 * The page's two scripts are the wire package's own modules, served by the
 * porter from where they are installed: the brain and the ANSI renderer.
 * Nothing is bundled and nothing is copied, so the greeter and the console
 * draw from one source.
 *
 * @module
 */

/** What both faces share. */
interface GreeterShell {
  title: string;
  /**
   * Where the door's own routes are, from this page: `./` for a page at
   * the door's root (`/login`), `../` for one a directory down
   * (`/greet/<key>`). Every address the page uses hangs off it, so a front
   * that puts the whole porter under a prefix moves them all.
   */
  root: './' | '../';
  /** The face's own markup, inside the frame. */
  body: string;
  /** The page's own script, run as a module after the shared ones load. */
  script: string;
}

/**
 * Escapes text for an HTML attribute or body.
 *
 * @param text - The text.
 * @returns The text with `& < > "` escaped.
 */
export function attribute_escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The shell around either face: the brain, the frame, the two modules. */
function shell_render(shell: GreeterShell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${attribute_escape(shell.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: dark; --frame: #1d7bb9; --lit: #66ccff; --dim: #5a8ca8; --ink: #dff; --bad: #ff9c9c; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: var(--ink); font-family: "Share Tech Mono", ui-monospace, monospace; }
  main { display: grid; gap: 1rem; width: min(64rem, 94vw); padding: 1.4rem 1.6rem 1.6rem; border-left: 0.6rem solid var(--frame); border-radius: 0 1.6rem 1.6rem 0; background: #05121c; }
  header { display: flex; align-items: baseline; gap: 1rem; }
  h1 { margin: 0; font-size: 1.1rem; letter-spacing: 0.25em; color: var(--lit); }
  .cube { font-size: 0.75rem; color: var(--dim); overflow-wrap: anywhere; }
  #brain { margin: 0; font-size: 0.62rem; line-height: 1.05; white-space: pre; overflow-x: auto; color: #9cf; }
  form { display: grid; gap: 0.8rem; width: min(22rem, 100%); }
  label { display: grid; gap: 0.25rem; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); }
  input { padding: 0.5rem 0.7rem; border: 1px solid var(--frame); border-radius: 0.6rem; background: #000; color: var(--ink); font: inherit; }
  button, a.pill { padding: 0.45rem 1.2rem; border: 0; border-radius: 1rem; background: var(--lit); color: #000; font: inherit; font-weight: bold; letter-spacing: 0.1em; cursor: pointer; justify-self: start; text-decoration: none; }
  button:hover, a.pill:hover { filter: brightness(1.2); }
  .reason { margin: 0; padding: 0.4rem 0.7rem; border-radius: 0.6rem; background: #3a0a0a; color: var(--bad); font-size: 0.85rem; }
  #rows { margin: 0; font-size: 0.8rem; line-height: 1.35; white-space: pre-wrap; min-height: 6rem; max-height: 40vh; overflow-y: auto; }
  #state { font-size: 0.75rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--dim); }
  #state.ready { color: #33cc66; }
  #state.failed { color: var(--bad); }
</style>
</head>
<body>
<main>
  <header><h1>PORTER</h1><div class="cube" id="cube"></div></header>
  <pre id="brain" aria-hidden="true"></pre>
  ${shell.body}
</main>
<script type="module">
import { logo_frameRender } from '${shell.root}greeter/brain.js';
import { ansi_toHtml } from '${shell.root}greeter/ansi.js';
const brain = document.getElementById('brain');
const brain_draw = (frame, resting) => { brain.innerHTML = ansi_toHtml(logo_frameRender(frame, resting).join('\\n')); };
${shell.script}
</script>
</body>
</html>
`;
}

/**
 * The door: the brain at rest, a name and a password.
 *
 * @param cubeUrl - The CUBE this door serves, shown so the operator knows where the password goes.
 * @param reason - Why the last try was refused, when it was.
 * @returns The page.
 */
export function loginPage_render(cubeUrl: string, reason: string | null): string {
  const notice: string = reason === null ? '' : `<p class="reason" role="alert">${attribute_escape(reason)}</p>`;
  return shell_render({
    title: 'PORTER',
    root: './',
    body: `<form method="post" action="login">
    ${notice}
    <label>Username <input name="username" autocomplete="username" required autofocus /></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
    <button type="submit">LOG IN</button>
  </form>`,
    script: `document.getElementById('cube').textContent = ${JSON.stringify(cubeUrl)};
brain_draw(0, true);`,
  });
}

/**
 * The greet: the brain awake, the boot rows arriving, the hand-off.
 *
 * @param cubeUrl - The CUBE the session is booting against.
 * @param key - The session's key: where its boot streams from and where it will be mounted.
 * @returns The page.
 */
export function greetPage_render(cubeUrl: string, key: string): string {
  return shell_render({
    title: 'PORTER · booting',
    root: '../',
    body: `<div id="state">booting</div>
  <pre id="rows"></pre>
  <a class="pill" id="again" href="../login" hidden>BACK TO THE DOOR</a>`,
    script: `document.getElementById('cube').textContent = ${JSON.stringify(cubeUrl)};
const rows = document.getElementById('rows');
const state = document.getElementById('state');
const again = document.getElementById('again');
let frame = 0;
let awake = true;
const pulse = setInterval(() => { if (awake) brain_draw(frame++, false); }, 120);
brain_draw(0, false);
const feed = new EventSource(${JSON.stringify(`../boot/${key}`)});
feed.addEventListener('line', (event) => {
  const line = JSON.parse(event.data);
  rows.insertAdjacentHTML('beforeend', ansi_toHtml(line.text) + '\\n');
  rows.scrollTop = rows.scrollHeight;
});
const settle = (name, reason) => {
  feed.close();
  awake = false;
  clearInterval(pulse);
  brain_draw(0, true);
  state.textContent = name === 'ready' ? 'ready' : ('failed' + (reason ? ' — ' + reason : ''));
  state.className = name;
  if (name === 'ready') {
    setTimeout(() => { window.location.assign(${JSON.stringify(`../s/${key}/?door`)}); }, 700);
  } else {
    again.hidden = false;
  }
};
feed.addEventListener('ready', () => settle('ready', null));
feed.addEventListener('failed', (event) => settle('failed', JSON.parse(event.data).reason));
feed.onerror = () => { if (state.className === '') settle('failed', 'the boot stream closed'); };`,
  });
}
