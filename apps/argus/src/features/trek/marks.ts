/**
 * @file The marks the bridge draws instead of the C's letters: one symbol
 * per kind of thing, drawn the same wherever that thing appears (the scan,
 * a wheel's rim, a target pill, the legend), so one mark means one thing
 * everywhere. The glyph the C prints stays in titles, the legend and the
 * log, which is the engine's own voice.
 *
 * Klingons wear one of four marks each. The engine's Klingon list has no
 * ids, so the tracker gives a Klingon its mark when it is first seen at a
 * sector and carries it along the engine's own lines (`moves to`,
 * `escapes`, `destroyed`); when the short-range sensors are damaged the
 * engine prints no such lines, and the marks follow list order instead.
 *
 * The shield ring is a mark too: its width and colour are the ship's
 * shield over its maximum, read from the state.
 *
 * @module
 */
import type { XY } from 'bsd-trek/host';
import type { SectorKind } from './model.js';

/**
 * Makes an SVG element.
 *
 * @param tag - The SVG tag.
 * @param attributes - Its attributes.
 * @returns The element.
 */
export function svg(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node: SVGElement = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** What a mark can stand for: a sector's kinds, and a dead quadrant on the chart. */
export type MarkKind = Exclude<SectorKind, 'empty'> | 'supernova';

/** The four Klingon marks, in the order they are handed out. */
export const KLINGON_MARKS: ReadonlyArray<string> = ['cruiser', 'raptor', 'talon', 'warbird'];

/** The symbols, as the inner markup of a 24 by 24 `<symbol>`; `currentColor` takes the kind's colour. */
const SYMBOLS: Readonly<Record<string, string>> = {
  // the ship: a saucer over a hull with two pods; generic, no franchise hull
  'ship': '<g fill="currentColor"><ellipse cx="12" cy="6.5" rx="9" ry="4"/><rect x="9.5" y="9.5" width="5" height="6" rx="1"/><rect x="3" y="14" width="5" height="8" rx="2.2"/><rect x="16" y="14" width="5" height="8" rx="2.2"/><rect x="7" y="16" width="10" height="2.2" rx="1"/></g>',
  // cruiser: a small head far forward on a long neck, a broad wing swept aft with drooped tips, an engine block
  'klingon-cruiser': '<g fill="currentColor"><circle cx="12" cy="4" r="2.6"/><rect x="11" y="5.5" width="2" height="8.5"/><path d="M12 12.5 L22 20.5 L22.5 22.5 L17 19.2 L12 18 L7 19.2 L1.5 22.5 L2 20.5 Z"/><rect x="8.5" y="18.5" width="7" height="3.2" rx="1.2"/></g>',
  // raptor: beak forward, wings swept down and out, tail feathers
  'klingon-raptor': '<path fill="currentColor" d="M12 1.5 L14 6.5 L22.5 10.5 L21.5 18 L19.5 12.5 L15 13.5 L14 20 L12 17 L10 20 L9 13.5 L4.5 12.5 L2.5 18 L1.5 10.5 L10 6.5 Z"/>',
  // talon: a long nose between two forward-raked claws, a wing closing aft
  'klingon-talon': '<g fill="currentColor"><path d="M12 1.5 L13.6 11 L21.5 4.5 L19 15 L12 22 L5 15 L2.5 4.5 L10.4 11 Z"/><circle cx="12" cy="13.5" r="1.6" fill="#000"/></g>',
  // warbird: a hammerhead command section on a neck, a broad crescent wing with a notch aft
  'klingon-warbird': '<g fill="currentColor"><rect x="8.5" y="2" width="7" height="3.2" rx="1.6"/><rect x="11.1" y="4.5" width="1.8" height="7"/><path d="M1.5 13 Q12 6 22.5 13 L22 20 Q17 15.5 14 17 L12 22 L10 17 Q7 15.5 2 20 Z"/></g>',
  // a starbase: a spindle station
  'base': '<g fill="currentColor"><path d="M12 1.5 L17 12 L12 22.5 L7 12 Z"/><rect x="1.5" y="10.8" width="21" height="2.4" rx="1.2"/><circle cx="12" cy="12" r="3" fill="#000"/></g>',
  // an inhabited system: a banded planet
  'inhabited': '<circle cx="12" cy="12" r="7.5" fill="currentColor"/><path d="M4.5 12 Q12 15.5 19.5 12" fill="none" stroke="#000" stroke-width="1.6"/><path d="M5.5 8.5 Q12 11 18.5 8.5" fill="none" stroke="#000" stroke-width="1.2" opacity="0.6"/>',
  // a star: eight rays
  'star': '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M12 2 V22 M2 12 H22 M4.9 4.9 L19.1 19.1 M19.1 4.9 L4.9 19.1"/></g><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  // a black hole: a spiral
  'hole': '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 12 m0 -2.5 a2.5 2.5 0 1 1 -2.5 2.5"/><path d="M12 12 m0 -6 a6 6 0 1 1 -6 6"/><path d="M12 12 m0 -9.5 a9.5 9.5 0 1 1 -9.5 9.5" opacity="0.5"/></g>',
  // a supernova: the radiation trefoil, a dead quadrant on the chart
  'supernova': '<g fill="currentColor"><path d="M10 8.536 A4 4 0 0 1 14 8.536 L17.5 2.474 A11 11 0 0 0 6.5 2.474 Z"/><path d="M10 8.536 A4 4 0 0 1 14 8.536 L17.5 2.474 A11 11 0 0 0 6.5 2.474 Z" transform="rotate(120 12 12)"/><path d="M10 8.536 A4 4 0 0 1 14 8.536 L17.5 2.474 A11 11 0 0 0 6.5 2.474 Z" transform="rotate(240 12 12)"/><circle cx="12" cy="12" r="2.4"/></g>',
};

/** The id prefix every symbol carries. */
const SYMBOL_PREFIX: string = 'tm-';

/**
 * The symbol id a kind draws with.
 *
 * @param kind - The kind.
 * @param variant - A Klingon's mark; ignored for other kinds.
 * @returns The id, without `#`.
 */
export function symbolId_of(kind: MarkKind, variant: string | null = null): string {
  if (kind === 'klingon') return `${SYMBOL_PREFIX}klingon-${variant !== null && KLINGON_MARKS.includes(variant) ? variant : KLINGON_MARKS[0]}`;
  return `${SYMBOL_PREFIX}${kind}`;
}

/**
 * The names of every symbol the table holds, for a test or a lint.
 *
 * @returns The names (`ship`, `klingon-cruiser`, ...).
 */
export function symbolNames_list(): ReadonlyArray<string> {
  return Object.keys(SYMBOLS);
}

/**
 * Builds the hidden `<svg>` of symbol definitions the marks refer to; one per document.
 *
 * @returns The element to append once, or null when the document already has the symbols.
 */
export function markDefs_make(): SVGElement | null {
  if (document.getElementById(`${SYMBOL_PREFIX}ship`) !== null) return null;
  const root: SVGElement = svg('svg', { class: 'tm-defs', width: 0, height: 0, 'aria-hidden': 'true' });
  const defs: SVGElement = svg('defs', {});
  for (const [name, markup] of Object.entries(SYMBOLS)) {
    const symbol: SVGElement = svg('symbol', { id: `${SYMBOL_PREFIX}${name}`, viewBox: '0 0 24 24' });
    symbol.innerHTML = markup;
    defs.append(symbol);
  }
  // the glows the motion layer paints with: a burst's halo in three colours, the photon torpedo's heart and halo
  const gradient = (id: string, stops: ReadonlyArray<[number, string, number]>): SVGElement => {
    const node: SVGElement = svg('radialGradient', { id: `${SYMBOL_PREFIX}${id}` });
    for (const [offset, color, opacity] of stops) {
      const stop: SVGElement = svg('stop', { offset });
      stop.setAttribute('style', `stop-color: ${color}; stop-opacity: ${opacity}`);
      node.append(stop);
    }
    return node;
  };
  defs.append(
    gradient('halo', [[0, 'var(--butter)', 0.9], [0.35, 'var(--harvestgold)', 0.5], [1, 'var(--harvestgold)', 0]]),
    gradient('halo-nova', [[0, 'var(--butter)', 0.9], [0.3, 'var(--pumpkin-pie)', 0.6], [1, 'var(--pumpkin-pie)', 0]]),
    gradient('halo-mars', [[0, 'var(--butter)', 0.8], [0.3, 'var(--mars)', 0.6], [1, 'var(--mars)', 0]]),
    gradient('photon-core', [[0, '#fff', 1], [0.35, '#ffd27a', 1], [1, '#ff6a1a', 1]]),
    gradient('photon-halo', [[0, '#ff6a1a', 0.55], [1, '#ff6a1a', 0]]),
  );
  root.append(defs);
  return root;
}

/**
 * Makes a `<use>` of a kind's symbol, placed in its drawing's own units.
 *
 * @param kind - The kind.
 * @param box - Where: the top-left corner and the side of the square it fills.
 * @param variant - A Klingon's mark.
 * @returns The `<use>`.
 */
export function mark_use(kind: MarkKind, box: { x: number; y: number; size: number }, variant: string | null = null): SVGElement {
  return svg('use', { href: `#${symbolId_of(kind, variant)}`, x: box.x, y: box.y, width: box.size, height: box.size, class: `tm-mark tm-mark-${kind}` });
}

/**
 * Makes a small inline icon of a kind's symbol, for a pill or the legend.
 *
 * @param kind - The kind.
 * @param variant - A Klingon's mark.
 * @returns An inline `<svg>`.
 */
export function markIcon_make(kind: MarkKind, variant: string | null = null): SVGElement {
  const icon: SVGElement = svg('svg', { viewBox: '0 0 24 24', class: `tm-icon tm-icon-${kind}`, 'aria-hidden': 'true' });
  icon.append(svg('use', { href: `#${symbolId_of(kind, variant)}` }));
  return icon;
}

/** The C's glyph for each kind, as the legend and titles name it. */
export const MARK_GLYPHS: Readonly<Record<MarkKind, string>> = { ship: 'E', klingon: 'K', base: '#', inhabited: '@', star: '*', hole: ' ', supernova: '///' };

/** The legend's rows, in its order. */
export const LEGEND: ReadonlyArray<{ kind: MarkKind; name: string }> = [
  { kind: 'ship', name: 'ENTERPRISE' }, { kind: 'klingon', name: 'KLINGON' }, { kind: 'base', name: 'STARBASE' },
  { kind: 'inhabited', name: 'INHABITED' }, { kind: 'star', name: 'STAR' }, { kind: 'hole', name: 'BLACK HOLE' }, { kind: 'supernova', name: 'SUPERNOVA' },
];

/** The engine's lines that move a Klingon, kill one, or send one away. */
const MOVES_TO: RegExp = /^Klingon at (\d+),(\d+) moves to (\d+),(\d+)/;
const ESCAPES: RegExp = /^Klingon at (\d+),(\d+) escapes to quadrant/;
const DESTROYED: RegExp = /\*\*\* Klingon at (\d+),(\d+) destroyed \*\*\*/;

/**
 * Which Klingon wears which mark, by where it is.
 */
export class KlingonTracker {
  private readonly marks: Map<string, string> = new Map<string, string>();

  /**
   * The mark of the Klingon at a sector.
   *
   * @param at - The sector.
   * @returns The mark, or null when no Klingon is known there.
   */
  public mark_of(at: XY): string | null {
    return this.marks.get(KlingonTracker.key_of(at)) ?? null;
  }

  /**
   * Hears one of the engine's lines: a Klingon that moved keeps its mark at its new sector, one that left or died frees it.
   *
   * @param line - The line.
   * @returns True when the line was one of the Klingons'.
   */
  public line_hear(line: string): boolean {
    const moved: RegExpExecArray | null = MOVES_TO.exec(line);
    if (moved !== null) {
      const from: string = `${moved[1]},${moved[2]}`;
      const mark: string | undefined = this.marks.get(from);
      this.marks.delete(from);
      if (mark !== undefined) this.marks.set(`${moved[3]},${moved[4]}`, mark);
      return true;
    }
    const gone: RegExpExecArray | null = ESCAPES.exec(line) ?? DESTROYED.exec(line);
    if (gone !== null) { this.marks.delete(`${gone[1]},${gone[2]}`); return true; }
    return false;
  }

  /**
   * Settles the marks against the Klingons the state shows: a newcomer takes the least-worn mark, one no longer there is dropped.
   *
   * @param klingons - The Klingons in the quadrant, in the engine's order.
   * @param options - `reset` forgets everything first (a new quadrant); `byOrder` hands marks out by list position, for when the sensors print no lines.
   */
  public reconcile(klingons: ReadonlyArray<XY>, options: { reset?: boolean; byOrder?: boolean } = {}): void {
    if (options.reset === true) this.marks.clear();
    const present: Set<string> = new Set<string>(klingons.map((k: XY): string => KlingonTracker.key_of(k)));
    for (const key of [...this.marks.keys()]) if (!present.has(key)) this.marks.delete(key);
    klingons.forEach((k: XY, index: number): void => {
      const key: string = KlingonTracker.key_of(k);
      if (options.byOrder === true) { this.marks.set(key, KLINGON_MARKS[index % KLINGON_MARKS.length] as string); return; }
      if (!this.marks.has(key)) this.marks.set(key, this.leastWorn_get());
    });
  }

  /**
   * Forgets every Klingon, as when the ship arrives somewhere new.
   */
  public clear(): void {
    this.marks.clear();
  }

  private leastWorn_get(): string {
    const worn: Map<string, number> = new Map<string, number>(KLINGON_MARKS.map((m: string): [string, number] => [m, 0]));
    for (const mark of this.marks.values()) worn.set(mark, (worn.get(mark) ?? 0) + 1);
    let best: string = KLINGON_MARKS[0] as string;
    for (const mark of KLINGON_MARKS) if ((worn.get(mark) ?? 0) < (worn.get(best) ?? 0)) best = mark;
    return best;
  }

  private static key_of(at: XY): string {
    return `${at.x},${at.y}`;
  }
}

/** How the shield ring is drawn. */
export interface ShieldRing {
  /** Its classes after `tb-ring`: the colour band, down, docked. */
  className: string;
  /** Its stroke width, in sector units. */
  width: number;
  /** The share of the maximum, 0 to 100. */
  percent: number;
}

/**
 * The shield ring for a ship: thick and cool when full, thinner and warmer as it drains, thin and dashed when down, gold under a starbase's shields.
 *
 * @param shield - The shield's units.
 * @param max - Its maximum.
 * @param up - Whether the shields are up.
 * @param docked - Whether the ship is docked, under the starbase's shields.
 * @returns The ring.
 */
export function shieldRing_of(shield: number, max: number, up: boolean, docked: boolean): ShieldRing {
  const percent: number = Math.max(0, Math.min(100, (100 * shield) / Math.max(1, max)));
  if (docked) return { className: 'tb-ring tb-ring-docked', width: 0.09, percent };
  if (!up) return { className: 'tb-ring tb-ring-down', width: 0.02, percent };
  const band: string = percent > 60 ? 'tb-ring-full' : percent > 30 ? 'tb-ring-mid' : 'tb-ring-low';
  return { className: `tb-ring ${band}`, width: 0.025 + (0.085 * percent) / 100, percent };
}
