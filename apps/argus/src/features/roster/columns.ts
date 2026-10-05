/**
 * @file Columns sized by hand: the grip on a cap, the floor a column keeps,
 * and the memory a device holds of what was sized.
 *
 * Every listing declares its tracks once and the façade writes the grid;
 * this module lets a hand move one boundary. A drag on a cap's grip
 * resizes that column; the expanse (`1fr`) is never grabbed and takes the
 * difference, so the alignment the expanse rule bought (bars at one x
 * across levels) survives any sizing (law the-expanse-is-never-sized-by-
 * hand). A column keeps the floor its declaration gave it (`minmax`'s
 * min, else 3em), a double-press on the grip gives one column back, and
 * what was sized is remembered per device in the browser's storage, keyed
 * by the listing's prefix and the trait — a tablet and a desk want
 * different widths, so the memory is the device's.
 *
 * @module
 */

/** Whether a track is the expanse: the one `fr` track the rule allows. */
export function track_isExpanse(width: string): boolean {
  return /\bfr\b/.test(width);
}

/**
 * The floor a column keeps, in CSS length: `minmax(min, …)`'s min, else
 * the declared width when it is smaller than 3em, else 3em.
 *
 * @param width - The trait's declared track.
 * @returns A CSS length.
 */
export function floor_of(width: string): string {
  const minmax: RegExpMatchArray | null = width.trim().match(/^minmax\(\s*([^,]+?)\s*,/);
  if (minmax !== null) return (minmax[1] ?? '3em').trim();
  return '3em';
}

/** The storage a device keeps sizes in: the browser's, or a test's. */
export interface ColumnStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORE_PREFIX: string = 'argus.columns';

/** The browser's local storage when it answers, else null (a private window, a blocked origin). */
export function columnStore_default(): ColumnStore | null {
  try {
    const store: Storage | undefined = globalThis.localStorage;
    if (store === undefined) return null;
    store.getItem(`${STORE_PREFIX}.probe`);
    return store;
  } catch {
    return null;
  }
}

/**
 * The sizes a device remembers for one listing.
 *
 * @param store - Where sizes live.
 * @param prefix - The listing's chrome prefix (`files`, `runs`).
 * @param keys - The trait keys the listing has.
 * @returns Trait key → width in px, for the ones remembered.
 */
export function columns_read(store: ColumnStore | null, prefix: string, keys: ReadonlyArray<string>): Map<string, number> {
  const sizes: Map<string, number> = new Map();
  if (store === null) return sizes;
  for (const key of keys) {
    try {
      const raw: string | null = store.getItem(`${STORE_PREFIX}.${prefix}.${key}`);
      const px: number = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(px) && px > 0) sizes.set(key, Math.round(px));
    } catch {
      // A store that refuses a read remembers nothing for this key.
    }
  }
  return sizes;
}

/** Remembers one column's size, or forgets it (null). */
export function column_write(store: ColumnStore | null, prefix: string, key: string, px: number | null): void {
  if (store === null) return;
  try {
    if (px === null) store.removeItem(`${STORE_PREFIX}.${prefix}.${key}`);
    else store.setItem(`${STORE_PREFIX}.${prefix}.${key}`, String(Math.round(px)));
  } catch {
    // A store that refuses a write forgets; the size holds for this page.
  }
}

/** What the grips need of their listing. */
export interface GripHooks {
  /** The trait key a cap stands for. */
  key_of: (cap: HTMLElement) => string | null;
  /** The floor of a column, in px, measured where the cap stands. */
  floor_of: (key: string) => number;
  /** How much the expanse can still give, in px. */
  expanseSlack: () => number;
  /** A column was dragged to a width. */
  size: (key: string, px: number) => void;
  /** A grip was pressed twice: the column goes back to its declaration. */
  reset: (key: string) => void;
}

/** The class a cap's grip wears. */
export const GRIP_CLASS: string = 'roster-grip';

/**
 * Wires every grip in a caps row: pointer drag sizes the cap's column,
 * a double-press resets it, and no press reaches the cap's sort.
 *
 * @param caps - The caps row (`.roster-caps`).
 * @param hooks - The listing's part.
 */
export function grips_wire(caps: HTMLElement, hooks: GripHooks): void {
  for (const grip of caps.querySelectorAll<HTMLElement>(`.${GRIP_CLASS}`)) {
    if (grip.dataset['wired'] === '1') continue;
    grip.dataset['wired'] = '1';
    const cap: HTMLElement | null = grip.closest<HTMLElement>('.roster-cap');
    if (cap === null) continue;
    grip.addEventListener('click', (event: MouseEvent): void => { event.stopPropagation(); });
    grip.addEventListener('dblclick', (event: MouseEvent): void => {
      event.stopPropagation();
      const key: string | null = hooks.key_of(cap);
      if (key !== null) hooks.reset(key);
    });
    grip.addEventListener('pointerdown', (down: PointerEvent): void => {
      const key: string | null = hooks.key_of(cap);
      if (key === null || down.button !== 0) return;
      down.preventDefault();
      down.stopPropagation();
      grip.setPointerCapture(down.pointerId);
      const startX: number = down.clientX;
      const startWidth: number = cap.getBoundingClientRect().width;
      const floor: number = hooks.floor_of(key);
      const ceiling: number = startWidth + hooks.expanseSlack();
      caps.classList.add('roster-sizing');
      const move = (event: PointerEvent): void => {
        const wanted: number = startWidth + (event.clientX - startX);
        hooks.size(key, Math.round(Math.min(ceiling, Math.max(floor, wanted))));
      };
      const up = (): void => {
        caps.classList.remove('roster-sizing');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }
}

/**
 * A CSS length in px, measured on an element (em and rem resolve against it).
 *
 * @param length - A CSS length (`12em`, `96px`, `5.2rem`).
 * @param on - The element whose font sizes the em is read against.
 * @returns Pixels, or 0 when the length cannot be read.
 */
export function length_px(length: string, on: HTMLElement): number {
  const m: RegExpMatchArray | null = length.trim().match(/^([\d.]+)\s*(px|em|rem)$/);
  if (m === null) return 0;
  const n: number = Number(m[1]);
  if (m[2] === 'px') return n;
  const base: HTMLElement = m[2] === 'rem' ? document.documentElement : on;
  const font: number = Number.parseFloat(getComputedStyle(base).fontSize) || 16;
  return n * font;
}
