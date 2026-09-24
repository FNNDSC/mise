/**
 * @file A page older than the build it is served from says so.
 *
 * argus loads some of itself on demand — the image engine, the volume
 * viewer — as chunks whose names carry a hash of the build. A tab loaded
 * before a deploy (an `npm install -g` upgrade, a `make cook`) holds the
 * old names; when it later asks for one, the server has only the new ones
 * and the load fails. The browser reports that in its developer console and
 * nowhere else, so an image pane simply never opened.
 *
 * Law honest-wait: a failure is visible and truthful. The page says, once, on the console and
 * in a notice over the stage, that the server has a newer argus and a
 * reload continues — and the notice's RELOAD does it.
 *
 * @module
 */

/** What a failed on-demand chunk load looks like, across browsers. */
const STALE_MESSAGE: RegExp = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/**
 * Whether a failure is a chunk of an older build that the server no
 * longer has.
 *
 * @param reason - What was thrown or rejected.
 * @returns True for a failed on-demand module load.
 */
export function stalePage_is(reason: unknown): boolean {
  const message: string = reason instanceof Error ? reason.message : String(reason ?? '');
  return STALE_MESSAGE.test(message);
}

/**
 * Watches for a load of a chunk the server no longer has, and says so.
 *
 * @param note - Writes a line to the console.
 * @param host - Where the notice stands; the page body by default.
 */
export function stalePage_watch(note: (line: string) => void, host: HTMLElement = document.body): void {
  let told: boolean = false;
  const tell = (): void => {
    if (told) return;
    told = true;
    note('argus: the server has a newer argus than this page — reload to continue (what failed to load was part of the old one)');
    const notice: HTMLDivElement = document.createElement('div');
    notice.className = 'stale-page';
    notice.setAttribute('role', 'alert');
    const words: HTMLSpanElement = document.createElement('span');
    words.className = 'stale-page-words';
    words.textContent = 'ARGUS WAS UPDATED ON THE SERVER — THIS PAGE IS OLDER';
    const reload: HTMLButtonElement = document.createElement('button');
    reload.className = 'pacs-capsule stale-page-reload';
    reload.textContent = 'RELOAD';
    reload.title = 'load the argus the server has now';
    reload.addEventListener('click', (): void => { window.location.reload(); });
    notice.append(words, reload);
    host.appendChild(notice);
  };
  // Vite's loader announces a failed chunk before it throws; answered here,
  // the failure is the page's to explain rather than an uncaught error.
  window.addEventListener('vite:preloadError', (event: Event): void => {
    event.preventDefault();
    tell();
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent): void => {
    if (stalePage_is(event.reason)) tell();
  });
}
