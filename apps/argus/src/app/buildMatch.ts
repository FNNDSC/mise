/**
 * @file ARGUS and the calypso daemon say when they are different builds.
 *
 * The calypso daemon serves ARGUS from disk on every load, but runs the code
 * it started with. Rebuild ARGUS (a `make cook`) or upgrade the install under
 * a running daemon, and a freshly loaded ARGUS talks to an older daemon: a
 * control the new ARGUS sends that the old daemon does not know simply does
 * nothing — EDIT opened no pane, and nothing said why.
 *
 * Two questions, asked of the one who can answer each. Is the daemon's own
 * code still the code on its disk? The daemon answers (`stale`, at attach
 * and pushed when it flips); an ARGUS-only release changes no daemon code
 * and so says nothing. Is this ARGUS older than the one the daemon started
 * beside? The daemon's stamp of ARGUS answers. Either says, on the console,
 * the status strip and in a notice over the stage, what is older and what to
 * restart: the calypso daemon, or ARGUS itself (Refresh, the control in the
 * sentence). The words name the two processes, never "session" or "page".
 * A daemon too old to report `stale` falls back to the stamp alone.
 *
 * Law honest-wait: a failure is visible and truthful.
 *
 * @module
 */
import type { StackInfo } from '../calypso/client.js';

/** A build's identity: the commit and the UTC minute it was built (`YYYY-MM-DD HH:MM`). */
export interface BuildStamp {
  git: string;
  built: string;
}

/** Which of ARGUS and the calypso daemon is the older build. */
export type BuildMismatch = 'daemon-older' | 'argus-older';

/**
 * Whether ARGUS and the calypso daemon are different builds, and which is older.
 *
 * A daemon that says whether it is stale is believed: stale means its own
 * code moved on disk; not stale leaves only the question of an ARGUS older
 * than the one it started beside. A daemon too old to say falls back to the
 * stamp: no stamp at all is older than any ARGUS that carries one, and a
 * stamp unlike this ARGUS's is ordered by its build minute.
 *
 * @param page - This ARGUS's stamp.
 * @param stack - What the daemon reported.
 * @param stale - Whether the daemon says its own code moved; undefined from older daemons.
 * @returns The older one, or null when they agree or nothing can be said.
 */
export function buildMismatch_of(page: BuildStamp, stack: StackInfo | undefined, stale?: boolean): BuildMismatch | null {
  if (stale === true) return 'daemon-older';
  if (stack === undefined) return null;
  const served: BuildStamp | undefined = stack.surface;
  if (stale === false) return served !== undefined && page.built < served.built ? 'argus-older' : null;
  if (served === undefined) return 'daemon-older';
  if (served.git === page.git && served.built === page.built) return null;
  // The minute stamps are ISO-ordered, so they compare as strings.
  return page.built >= served.built ? 'daemon-older' : 'argus-older';
}

/** What each mismatch says: a readout for the status strip, the sentence, and its cure. */
export const BUILD_MISMATCH_WORDS: Readonly<Record<BuildMismatch, { readout: string; before: string; cure: string; after: string }>> = {
  'daemon-older': {
    readout: 'CALYPSO DAEMON OUT OF DATE',
    before: 'The calypso daemon has been updated and should be restarted; some controls may not work until then. ',
    cure: 'Restart the calypso daemon',
    after: '.',
  },
  'argus-older': {
    readout: 'ARGUS OUT OF DATE',
    before: 'ARGUS is older than the calypso daemon. ',
    cure: 'Refresh',
    after: ' to load the new ARGUS.',
  },
};

/**
 * The whole sentence, as the console says it.
 *
 * @param mismatch - The older one.
 * @returns The sentence.
 */
export function buildMismatch_sentence(mismatch: BuildMismatch): string {
  const words = BUILD_MISMATCH_WORDS[mismatch];
  return `${words.before}${words.cure}${words.after}`;
}

/**
 * Says a mismatch on the console and in a notice over the stage. ARGUS's
 * cure (Refresh) is a control; the daemon's (a restart) is words, since
 * ARGUS cannot restart the process that serves it.
 *
 * @param mismatch - The older one.
 * @param page - This ARGUS's stamp.
 * @param stack - What the daemon reported.
 * @param note - Writes a line to the console.
 * @param host - Where the notice stands; the page body by default.
 */
export function buildMismatch_tell(
  mismatch: BuildMismatch,
  page: BuildStamp,
  stack: StackInfo,
  note: (line: string) => void,
  host: HTMLElement = document.body,
): void {
  host.querySelector('.build-mismatch')?.remove();
  const served: string = stack.surface !== undefined
    ? `ARGUS ${stack.surface.git} built ${stack.surface.built}Z`
    : 'an ARGUS too old to say its build';
  note(`argus: ${buildMismatch_sentence(mismatch)}`);
  // The evidence is what differs: the two ARGUS builds when they do,
  // otherwise the daemon's own code on its disk.
  const sameArgus: boolean = stack.surface !== undefined && stack.surface.git === page.git && stack.surface.built === page.built;
  note(sameArgus
    ? `argus: the calypso daemon's own code on disk has changed since it started (ARGUS ${page.git} built ${page.built}Z)`
    : `argus: ARGUS ${page.git} built ${page.built}Z · calypso daemon started with ${served}`);
  const words = BUILD_MISMATCH_WORDS[mismatch];
  const notice: HTMLDivElement = document.createElement('div');
  notice.className = 'stale-page build-mismatch';
  notice.dataset['mismatch'] = mismatch;
  notice.setAttribute('role', 'alert');
  const sentence: HTMLSpanElement = document.createElement('span');
  sentence.className = 'stale-page-words';
  let cure: Node = document.createTextNode(words.cure);
  if (mismatch === 'argus-older') {
    const refresh: HTMLButtonElement = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'stale-page-reload';
    refresh.textContent = words.cure;
    refresh.title = 'reload this tab to load the new ARGUS';
    refresh.addEventListener('click', (): void => { window.location.reload(); });
    cure = refresh;
  }
  sentence.append(document.createTextNode(words.before), cure, document.createTextNode(words.after));
  // The operator may carry on knowingly; the status strip keeps the readout.
  const dismiss: HTMLButtonElement = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'build-mismatch-dismiss';
  dismiss.textContent = '×';
  dismiss.title = 'dismiss (the status strip keeps saying it)';
  dismiss.addEventListener('click', (): void => { notice.remove(); });
  notice.append(sentence, dismiss);
  host.appendChild(notice);
}

/** What the host does with the build question, at attach and after. */
export interface BuildWatch {
  /** The attach ack arrived: judge it. */
  attach_take: (attach: { stack?: StackInfo; stale?: boolean }) => void;
  /** The daemon pushed a change in whether its own code moved. */
  stale_take: (stale: boolean) => void;
  /** The boot's greeting stands: console lines held for it are written, later ones at once. */
  release: () => void;
}

/**
 * Wires the build question to a host: the status strip reads it out, the
 * console and a notice say which is older and what to restart. The dev
 * server's ARGUS is never the bundle a daemon serves, so it is not compared.
 *
 * @param strip - The status strip's readout.
 * @param note - Writes a line to the console.
 * @param host - Where the notice stands.
 * @returns The watch.
 */
export function buildMatch_wire(
  strip: { build_show: (readout: string | null, title?: string) => void },
  note: (line: string) => void,
  host: HTMLElement = document.body,
): BuildWatch {
  const page: BuildStamp = { git: __ARGUS_GIT__, built: __ARGUS_BUILT__ };
  let held: string[] | null = [];
  let stack: StackInfo | undefined;
  let shown: BuildMismatch | null = null;
  const say = (line: string): void => { if (held !== null) held.push(line); else note(line); };
  const judge = (stale: boolean | undefined): void => {
    if (__ARGUS_DEV__ || stack === undefined) return;
    const mismatch: BuildMismatch | null = buildMismatch_of(page, stack, stale);
    if (mismatch === shown) return;
    shown = mismatch;
    if (mismatch === null) {
      strip.build_show(null);
      host.querySelector('.build-mismatch')?.remove();
      return;
    }
    strip.build_show(BUILD_MISMATCH_WORDS[mismatch].readout, buildMismatch_sentence(mismatch));
    buildMismatch_tell(mismatch, page, stack, say, host);
  };
  return {
    attach_take: (attach): void => { stack = attach.stack; judge(attach.stale); },
    stale_take: (stale: boolean): void => judge(stale),
    release: (): void => {
      const lines: string[] = held ?? [];
      held = null;
      for (const line of lines) note(line);
    },
  };
}
