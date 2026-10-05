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
 *
 * A field also answers its own edges: a scroll that comes to rest at the top
 * or the foot, or a wheel or finger that pushes past one, flares that edge
 * in the theme's hue and gives the rows a small bounce, as a phone's list
 * does. The script only says which edge was met (`data-edge`); the
 * stylesheet owns the flare and the bounce (single-animation-author), and
 * draws neither under reduced motion.
 */

/** Which edge of a field was met. */
export type FieldEdge = 'top' | 'bottom';

/** How long one edge waits before it flares again, ms: a spinning wheel is one meeting, not twenty. */
export const EDGE_REST_MS: number = 450;

/** How far a finger pushes past an edge before it counts, px. */
const EDGE_PUSH_PX: number = 12;

/**
 * Says a field met an edge: the stylesheet flares it. Met again while the
 * flare still shows, within its rest, it is left alone.
 *
 * @param field - The field.
 * @param edge - The edge met.
 * @param now - The clock (a test hands in its own).
 * @returns Whether it flared.
 */
export function edge_meet(field: HTMLElement, edge: FieldEdge, now: number = Date.now()): boolean {
  const last: number = Number(field.dataset['edgeAt'] ?? 0);
  if (field.dataset['edge'] === edge && now - last < EDGE_REST_MS) return false;
  // Off and on again, so a second meeting replays the flare from its start.
  delete field.dataset['edge'];
  void field.offsetWidth;
  field.dataset['edge'] = edge;
  field.dataset['edgeAt'] = String(now);
  return true;
}

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
  /**
   * Whether this field is the one that scrolls just now. A field that
   * scrolls only in one layout (a phone's column) says nothing in another,
   * where a field inside it scrolls and speaks for itself — two chips
   * stacked, one for each, read as a glitch.
   */
  scrolls?: () => boolean;
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
      const overflowing: boolean = (options.scrolls?.() ?? true) && field.scrollHeight > field.clientHeight + 2;
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
  edges_wire(field, atFoot);
  // A test's document lays nothing out and has no ResizeObserver; the chip
  // still counts on scroll and refill.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(count).observe(field);
  new MutationObserver(count).observe(field, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  count();
  return chip;
}

/**
 * Wires a field's edges: a scroll at rest on an edge it moved to, and a wheel
 * or a finger pushing past an edge it already stands on. The flare's end
 * clears the state, so the next meeting starts clean.
 *
 * @param field - The scrolling field.
 * @param atFoot - Whether the field stands at its foot.
 */
function edges_wire(field: HTMLElement, atFoot: () => boolean): void {
  const overflowing = (): boolean => field.scrollHeight > field.clientHeight + 2;
  const atTop = (): boolean => field.scrollTop <= 0;
  let restedAt: number = field.scrollTop;
  field.addEventListener('scrollend', (): void => {
    const moved: boolean = field.scrollTop !== restedAt;
    restedAt = field.scrollTop;
    if (!moved || !overflowing()) return;
    if (atTop()) edge_meet(field, 'top');
    else if (atFoot()) edge_meet(field, 'bottom');
  });
  field.addEventListener('wheel', (event: WheelEvent): void => {
    if (!overflowing() || event.deltaY === 0) return;
    if (event.deltaY < 0 && atTop()) edge_meet(field, 'top');
    else if (event.deltaY > 0 && atFoot()) edge_meet(field, 'bottom');
  }, { passive: true });
  let touchY: number | null = null;
  field.addEventListener('touchstart', (event: TouchEvent): void => { touchY = event.touches[0]?.clientY ?? null; }, { passive: true });
  field.addEventListener('touchmove', (event: TouchEvent): void => {
    const y: number | undefined = event.touches[0]?.clientY;
    if (touchY === null || y === undefined || !overflowing()) return;
    // A finger drawing the list down at its top, or up at its foot, pushes past that edge.
    if (y - touchY > EDGE_PUSH_PX && atTop()) { edge_meet(field, 'top'); touchY = null; }
    else if (touchY - y > EDGE_PUSH_PX && atFoot()) { edge_meet(field, 'bottom'); touchY = null; }
  }, { passive: true });
  field.addEventListener('animationend', (event: AnimationEvent): void => {
    if (event.target === field && event.animationName.startsWith('edge-flare')) delete field.dataset['edge'];
  });
}
