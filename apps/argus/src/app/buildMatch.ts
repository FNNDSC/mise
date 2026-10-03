/**
 * @file ARGUS and the calypso daemon say when they are different builds.
 *
 * The calypso daemon serves ARGUS from disk on every load, but runs the code
 * it started with. Rebuild ARGUS (a `make cook`) or upgrade the install under
 * a running daemon, and a freshly loaded ARGUS talks to an older daemon: a
 * control the new ARGUS sends that the old daemon does not know simply does
 * nothing — EDIT opened no pane, and nothing said why.
 *
 * The daemon remembers ARGUS's build stamp when it starts and reports it in
 * its attach ack; ARGUS compares its own stamp against it. Agreeing says
 * nothing. Disagreeing says, once, on the console and in a notice over the
 * stage, which one is older and what to restart: the calypso daemon when
 * ARGUS is newer, ARGUS itself (Refresh, the control in the sentence) when
 * it is older. The words name the two processes, never "session" or "page".
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
 * A daemon that reports its stack but no ARGUS build predates the stamp, and
 * so is older than any ARGUS that carries one. A daemon that reports no stack at all
 * says too little to judge.
 *
 * @param page - This ARGUS's stamp.
 * @param stack - What the daemon reported.
 * @returns The older one, or null when they agree or nothing can be said.
 */
export function buildMismatch_of(page: BuildStamp, stack: StackInfo | undefined): BuildMismatch | null {
  if (stack === undefined) return null;
  const served: BuildStamp | undefined = stack.surface;
  if (served === undefined) return 'daemon-older';
  if (served.git === page.git && served.built === page.built) return null;
  // The minute stamps are ISO-ordered, so they compare as strings.
  return page.built >= served.built ? 'daemon-older' : 'argus-older';
}

/** What each mismatch says: a readout for the status strip, the sentence, and its cure. */
export const BUILD_MISMATCH_WORDS: Readonly<Record<BuildMismatch, { readout: string; before: string; cure: string; after: string }>> = {
  'daemon-older': {
    readout: 'CALYPSO DAEMON OUT OF DATE',
    before: 'ARGUS is newer than the calypso daemon, so some controls won\'t work. ',
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
  const served: string = stack.surface !== undefined
    ? `ARGUS ${stack.surface.git} built ${stack.surface.built}Z`
    : 'an ARGUS too old to say its build';
  note(`argus: ${buildMismatch_sentence(mismatch)}`);
  note(`argus: ARGUS ${page.git} built ${page.built}Z · calypso daemon started with ${served}`);
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

/**
 * Says when this ARGUS and the calypso daemon are different builds: the
 * status strip reads it out, the console and a notice say which is older and
 * what to restart. The dev server's ARGUS is never the bundle a daemon
 * serves, so it is not compared.
 *
 * @param stack - What the daemon reported in its attach ack.
 * @param strip - The status strip's readout.
 * @param note - Writes a line to the console.
 */
export function buildMatch_check(
  stack: StackInfo | undefined,
  strip: { build_show: (readout: string, title: string) => void },
  note: (line: string) => void,
): void {
  if (__ARGUS_DEV__ || stack === undefined) return;
  const page: BuildStamp = { git: __ARGUS_GIT__, built: __ARGUS_BUILT__ };
  const mismatch: BuildMismatch | null = buildMismatch_of(page, stack);
  if (mismatch === null) return;
  strip.build_show(BUILD_MISMATCH_WORDS[mismatch].readout, buildMismatch_sentence(mismatch));
  buildMismatch_tell(mismatch, page, stack, note);
}
