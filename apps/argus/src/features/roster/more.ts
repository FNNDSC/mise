/**
 * @file A field that holds more than it shows says so.
 *
 * The surface has no scrollbars. A field that scrolls — a listing's rows, a
 * frame's blocks, a file's text, the band's cohort — hides the browser's
 * bar and wears a chip at its foot instead: `▼ N MORE` while content lies
 * below the view, `▲ TOP` once the foot is reached. The wheel and the
 * finger still scroll; the chip is the field saying what it holds, and a
 * press moves one page. N is what the field counts: rows for a listing,
 * lines for text. One helper, so every field says it the same way
 * (aegis.adoc: a-field-says-it-holds-more).
 */

/**
 * Every scrolling field on the surface, by the class its stylesheet rule
 * names. The aegis lint (a-field-says-it-holds-more) holds each
 * `overflow: auto` rule in argus.css to this list, and each name here to a
 * `more_wire` call in the source that names it — so a pane that grows a
 * scrolling field wires the chip or fails CI. A container whose child is
 * the wired field (the gather mount, the table mount) does not scroll
 * itself and is not here.
 */
export const MORE_FIELDS: ReadonlyArray<string> = [
  'listing-field',   // every listing's rows (features/roster/host.ts)
  'files-content',   // a file's text (features/files/panel.ts)
  'gather-rows',     // the band's cohort (app/main.ts)
  'empty-result',    // an errand pane's answer (features/empty/panel.ts)
  'launcher-grid',   // the dashboard's tiles (features/launcher/panel.ts)
  'launcher-body',   // the same tiles on a phone, where the body scrolls
  'panes-body',      // the PANES desktop cards (app/main.ts)
  'view-body',       // the slaved viewer's text or picture (app/main.ts)
  'dag-facts',       // a node's readout, immersed (app/main.ts)
  'dag-facts-immersed', // the same readout's immersed rule
  'mode-frame',      // every mode frame's blocks (app/main.ts)
  'pacs-workspace',  // the PACS pane whole, by id (app/main.ts)
];

/** The one scrolling field that keeps the terminal's own idiom: the console's scrollback. */
export const SCROLLBACK_FIELDS: ReadonlyArray<string> = ['argus-output'];

/** How a field counts what lies below, and what its chip does. */
export interface MoreOptions {
  /** A selector for the field's rows; absent, the field counts lines of text. */
  rows?: string;
  /** The chip's words, given what lies below and whether the foot is reached. */
  label?: (below: number, atFoot: boolean) => string;
  /** What a press does; absent, it scrolls one page (or back to the top at the foot). */
  press?: () => void;
  /** Classes the chip wears beside `more-chip` (an older name a stylesheet or test knows). */
  className?: string;
  /** Where the chip is appended; the field itself by default, where it sticks to the foot. */
  mount?: HTMLElement;
}

/** The chip's default words. */
export function moreLabel_default(below: number, atFoot: boolean): string {
  return atFoot ? '▲ TOP' : `▼ ${below} MORE`;
}

/**
 * Counts the rows of a field that lie below its view.
 *
 * @param field - The scrolling field.
 * @param rows - The rows' selector.
 * @returns How many rows start at or below the field's foot.
 */
export function rowsBelow_count(field: HTMLElement, rows: string): number {
  const foot: number = field.getBoundingClientRect().bottom;
  let below: number = 0;
  for (const row of field.querySelectorAll<HTMLElement>(rows)) {
    const box: DOMRect = row.getBoundingClientRect();
    if (box.height > 0 && box.top >= foot - 2) below += 1;
  }
  return below;
}

/**
 * Counts the lines of a text field that lie below its view.
 *
 * @param field - The scrolling field.
 * @returns How many lines of its own line height remain below the foot.
 */
export function linesBelow_count(field: HTMLElement): number {
  const lineHeight: number = parseFloat(getComputedStyle(field).lineHeight) || 16;
  return Math.max(0, Math.ceil((field.scrollHeight - field.scrollTop - field.clientHeight) / lineHeight));
}

/**
 * Gives a scrolling field its chip, and keeps the chip true as the field
 * scrolls, resizes and refills.
 *
 * @param field - The element that scrolls.
 * @param options - How it counts and what the chip does.
 * @returns The chip.
 */
export function more_wire(field: HTMLElement, options: MoreOptions = {}): HTMLButtonElement {
  field.dataset['more'] = 'wired';
  field.classList.add('holds-more');
  const chip: HTMLButtonElement = document.createElement('button');
  chip.type = 'button';
  chip.className = `more-chip${options.className !== undefined ? ` ${options.className}` : ''}`;
  chip.hidden = true;
  const label: (below: number, atFoot: boolean) => string = options.label ?? moreLabel_default;
  const atFoot = (): boolean => field.scrollTop + field.clientHeight >= field.scrollHeight - 2;
  chip.addEventListener('click', (event: Event): void => {
    event.stopPropagation();
    if (options.press !== undefined) { options.press(); return; }
    field.scrollBy({ top: atFoot() ? -field.scrollHeight : Math.max(1, field.clientHeight - chip.offsetHeight), behavior: 'smooth' });
  });
  const mount: HTMLElement = options.mount ?? field;
  mount.appendChild(chip);
  let settling: boolean = false;
  const count = (): void => {
    if (settling) return;
    settling = true;
    try {
      // A sticky foot must be the last thing in the flow; a refill that
      // appended rows after the chip puts it back at the end.
      if (mount === field && field.lastElementChild !== chip) field.appendChild(chip);
      const overflowing: boolean = field.scrollHeight > field.clientHeight + 2;
      if (chip.hidden !== !overflowing) chip.hidden = !overflowing;
      if (!overflowing) return;
      const below: number = options.rows !== undefined ? rowsBelow_count(field, options.rows) : linesBelow_count(field);
      const words: string = label(below, atFoot());
      if (chip.textContent !== words) chip.textContent = words;
    } finally {
      settling = false;
    }
  };
  field.addEventListener('scroll', count, { passive: true });
  // A test's document lays nothing out and has no ResizeObserver; the chip
  // still counts on scroll and refill.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(count).observe(field);
  new MutationObserver(count).observe(field, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  count();
  return chip;
}
