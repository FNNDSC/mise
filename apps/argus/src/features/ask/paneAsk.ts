/**
 * @file A question the surface asks, materialized on the pane that asked it.
 *
 * A transient question has to appear where the hand that provoked it is.
 * The console was the one place every question went, and a console can be
 * closed: PROCESS on a cohort asked for a name into a drawer of zero
 * height, so the press looked dead, the surface sat waiting on a question
 * nobody could see, and the next press was refused because one was already
 * open. A question nobody can see is a question nobody can answer.
 *
 * So a question the SURFACE puts — a name for this cohort, a title for this
 * run, a name for this directory — opens on the pane that asked, as a bar
 * of its own across its head: the question stated, the value editable, one
 * verb that commits reading what it will do, and ABANDON beside it. A
 * yes/no is two capsules instead of a field. Esc abandons wherever the
 * hands are. The bar belongs to the question and leaves with it.
 *
 * The console still holds the exchange — the asking and the answer both go
 * to the transcript through `ask_note` — so the scrollback remains the
 * whole story of the session. What changed is where the operator answers,
 * not what the session records. A question the SESSION puts still belongs
 * in the console, since that is where the session speaks; the console
 * exposes itself to carry it.
 *
 * @module
 */

/** What kind of value answers a question. */
export type PaneAskKind = 'text' | 'secret' | 'confirm';

/**
 * A question put on a pane.
 *
 * @property message - The question's own words.
 * @property kind - What kind of value answers it.
 * @property suggest - A value to offer, for a kind that takes one.
 * @property commit - The committing verb's words, reading what it will do.
 */
export interface PaneAskRequest {
  message: string;
  kind: PaneAskKind;
  suggest?: string;
  commit?: string;
}

/** The questions open on the surface, oldest first; Esc abandons the last. */
const open: Array<() => void> = [];

/** @returns Whether any pane is carrying a question. */
export function paneAsk_isOpen(): boolean {
  return open.length > 0;
}

/**
 * Abandons the most recent question a pane carries.
 *
 * @returns Whether there was one to abandon.
 */
export function paneAsk_abandon(): boolean {
  const last: (() => void) | undefined = open[open.length - 1];
  if (last === undefined) return false;
  last();
  return true;
}

/**
 * Where an ask bar stands: across the pane's head, under its title bar and
 * its drawer, above whatever field the pane holds.
 *
 * @param pane - The pane root.
 * @returns The element the bar is inserted before, or null for the end.
 */
function seat_find(pane: HTMLElement): Element | null {
  const drawer: Element | null = pane.querySelector(':scope > .pane-drawer');
  if (drawer !== null) return drawer.nextElementSibling;
  const bar: Element | null = pane.querySelector(':scope > .lcars-terminal-header-bar');
  return bar === null ? pane.firstElementChild : bar.nextElementSibling;
}

/**
 * Opens a question on a pane and waits for its answer.
 *
 * One at a time per pane: a second question on a pane already carrying one
 * is refused rather than stacked, as the console refuses a second.
 *
 * @param pane - The pane root the question belongs to.
 * @param request - The question.
 * @returns The answer, `'y'` or `'n'` for a confirm, null when abandoned.
 */
export function paneAsk_open(pane: HTMLElement, request: PaneAskRequest): Promise<string | null> {
  if (pane.querySelector(':scope > .ask-bar') !== null) return Promise.resolve(null);

  const bar: HTMLElement = document.createElement('div');
  bar.className = 'ask-bar';
  const glyph: HTMLElement = document.createElement('span');
  glyph.className = 'ask-bar-glyph';
  glyph.textContent = '?';
  const caption: HTMLElement = document.createElement('span');
  caption.className = 'ask-bar-caption';
  caption.textContent = request.message.trim();
  bar.append(glyph, caption);

  const field: HTMLInputElement = document.createElement('input');
  const yes: HTMLButtonElement = document.createElement('button');
  const no: HTMLButtonElement = document.createElement('button');
  const commit: HTMLButtonElement = document.createElement('button');
  const abandon: HTMLButtonElement = document.createElement('button');
  abandon.className = 'pacs-capsule ask-bar-abandon';
  abandon.textContent = 'ABANDON';
  abandon.title = 'abandon the question (Esc)';

  if (request.kind === 'confirm') {
    yes.className = 'pacs-capsule ask-bar-yes';
    yes.textContent = 'YES';
    no.className = 'pacs-capsule ask-bar-no';
    no.textContent = 'NO';
    bar.append(yes, no, abandon);
  } else {
    field.className = 'ask-bar-field';
    field.spellcheck = false;
    if (request.kind === 'secret') field.type = 'password';
    else if (request.suggest !== undefined) field.value = request.suggest;
    commit.className = 'pacs-capsule ask-bar-commit';
    commit.textContent = request.commit ?? 'ANSWER';
    bar.append(field, commit, abandon);
  }

  const seat: Element | null = seat_find(pane);
  if (seat === null) pane.appendChild(bar);
  else pane.insertBefore(bar, seat);
  // The bar is exposed rather than simply present: a band that arrives
  // under the hand that provoked it, the way the drawer glides. Motion is
  // still a verb — this one is the answer to a press.
  window.requestAnimationFrame((): void => bar.classList.add('ask-bar-shown'));

  return new Promise((resolve: (answer: string | null) => void): void => {
    let settled: boolean = false;
    const settle = (answer: string | null): void => {
      if (settled) return;
      settled = true;
      const index: number = open.indexOf(close);
      if (index >= 0) open.splice(index, 1);
      bar.remove();
      resolve(answer);
    };
    const close = (): void => settle(null);
    open.push(close);

    const typed = (): void => {
      const wanted: string = field.value.trim();
      settle(wanted === '' ? null : wanted);
    };
    commit.addEventListener('click', typed);
    yes.addEventListener('click', (): void => settle('y'));
    no.addEventListener('click', (): void => settle('n'));
    abandon.addEventListener('click', close);
    bar.addEventListener('keydown', (event: KeyboardEvent): void => {
      // The bar owns its own keys: Enter answers, Esc abandons, and neither
      // reaches the stage behind it while a question is standing.
      if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
      if (request.kind === 'confirm') {
        // A hand already on the keys should not have to reach for the
        // mouse, as the console's own confirm has always allowed.
        if (event.key === 'y' || event.key === 'Y') { event.stopPropagation(); settle('y'); }
        else if (event.key === 'n' || event.key === 'N') { event.stopPropagation(); settle('n'); }
        else if (event.key === 'Enter' && event.target === no) { event.stopPropagation(); settle('n'); }
        else if (event.key === 'Enter') { event.stopPropagation(); settle('y'); }
        return;
      }
      if (event.key === 'Enter') { event.stopPropagation(); typed(); }
    });
    if (request.kind === 'confirm') yes.focus();
    else { field.focus(); field.select(); }
  });
}
