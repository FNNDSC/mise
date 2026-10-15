/**
 * @file SHARE VIEW: the stage as a script another operator can replay
 * (law a-view-is-a-script).
 *
 * A view is shared as console lines: a baseline (`desktop clear`, the
 * dashboard every session starts at) and then the steps a desktop records
 * from there — the panes, the feed on a graph, its modes, the job it
 * stands on. Replayed from the baseline, the same lines give the same view
 * whatever the receiver had on screen. The sheet shows the script and
 * copies it, and says what happened, as LINK does.
 *
 * @module
 */
import { more_wire } from '../features/roster/more.js';

/** The line every shared view starts from. */
export const VIEW_BASELINE: string = 'desktop clear';

/**
 * A shared view's script: what it is, the baseline, then the steps.
 *
 * @param steps - The stage as a desktop serializes it.
 * @returns The script.
 */
export function viewScript_compose(steps: string): string {
  const lines: string[] = steps.split('\n').map((line: string): string => line.trim()).filter((line: string): boolean => line !== '' && !line.startsWith('#'));
  return ['# ARGUS view: run these lines in the ARGUS console to see what I see', VIEW_BASELINE, ...lines].join('\n');
}

/** How long the sheet's COPY says COPIED. */
const SHARE_ANNOUNCE_MS: number = 2500;

/**
 * Stands the share sheet over the stage: the script, COPY and CLOSE. The
 * script is copied at once; the pill says whether the browser took it,
 * and the text is selected for the hand where it did not.
 *
 * @param script - The view's script.
 * @param clipboard - The clipboard; the browser's own by default.
 * @returns The sheet.
 */
export function shareSheet_open(script: string, clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard): HTMLElement {
  document.querySelector('.share-sheet')?.remove();
  const sheet: HTMLElement = document.createElement('div');
  sheet.className = 'share-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'share this view');
  const head: HTMLElement = document.createElement('div');
  head.className = 'share-head';
  head.textContent = 'SHARE VIEW · THESE LINES PUT ANYONE WHERE YOU ARE';
  const text: HTMLPreElement = document.createElement('pre');
  text.className = 'share-script';
  text.textContent = script;
  const copy: HTMLButtonElement = document.createElement('button');
  copy.type = 'button';
  copy.className = 'share-copy';
  copy.textContent = 'COPY';
  const close: HTMLButtonElement = document.createElement('button');
  close.type = 'button';
  close.className = 'share-close';
  close.textContent = 'CLOSE';
  const pills: HTMLElement = document.createElement('div');
  pills.className = 'share-pills';
  pills.append(copy, close);
  sheet.append(head, text, pills);
  document.body.appendChild(sheet);
  // A long script scrolls in its box and says it holds more; the chip
  // stands on the sheet, never inside the lines it would be copied with.
  more_wire(text, { mount: sheet });

  let shown: number = 0;
  const copy_run = async (): Promise<void> => {
    let took: boolean = false;
    try {
      if (clipboard === undefined) throw new Error('no clipboard');
      await clipboard.writeText(script);
      took = true;
    } catch {
      const selection: Selection | null = window.getSelection();
      if (selection !== null) {
        const range: Range = document.createRange();
        range.selectNodeContents(text);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    sheet.dataset['copied'] = took ? 'yes' : 'no';
    copy.textContent = took ? 'COPIED' : 'SELECT + COPY';
    const at: number = ++shown;
    window.setTimeout((): void => {
      if (at !== shown) return;
      delete sheet.dataset['copied'];
      copy.textContent = 'COPY';
    }, SHARE_ANNOUNCE_MS);
  };
  copy.addEventListener('click', (): void => { void copy_run(); });
  close.addEventListener('click', (): void => sheet.remove());
  sheet.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape') sheet.remove();
  });
  void copy_run();
  close.focus();
  return sheet;
}
