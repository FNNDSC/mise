/**
 * @file The feed view's modes and its frame (law a-feed-has-one-view).
 *
 * A feed is opened by two doors — the RUNS roster, and the universe's
 * descent — and was drawn and framed differently by each. This module is
 * what a feed view is, whichever door: its modes (how it is arranged,
 * projected, drawn, coloured, sized, whether it pulses, its census and its
 * gravity), the device's memory of them, and one wiring for the pills that
 * change them. A pane mounts the frame over its own pills, found by their
 * `data-feed-verb`, so the pills keep the classes the pane's chrome and
 * its smoke already name, and the behaviour is written once.
 *
 * The memory is the device's (`localStorage`, `argus.feedview`): a tablet
 * and a desk may want a feed drawn differently, and a feed opened from the
 * roster looks exactly like the same feed after a descent on this device.
 *
 * @module
 */
import type { DrawMode, LayoutStrategy } from '@fnndsc/orrery';
import type { FeedDagModel } from '@fnndsc/menu';
import { hueLegend_build, type HueMode, type MetricMode } from '../../scene/feedGraph.js';

/** How a feed view stands. */
export interface FeedModes {
  /** Arranged as its tree (root on top), or as a molecule that finds its own shape. */
  strategy: LayoutStrategy;
  projection: '3d' | '2d';
  /** The arrival wave runs on a loop. */
  pulse: boolean;
  metric: MetricMode;
  hue: HueMode;
  /** The full multiplicity, instanced, rather than the shape. */
  census: boolean;
  gravity: boolean;
  draw: DrawMode;
}

/** A feed opens as its tree, root on top, lit as spheres, sized by time, coloured by status. */
export const FEED_MODES_DEFAULT: Readonly<FeedModes> = {
  strategy: 'ranked',
  projection: '3d',
  pulse: false,
  metric: 'time',
  hue: 'status',
  census: false,
  gravity: false,
  draw: 'spheres',
};

const STORE_KEY: string = 'argus.feedview';

/** The storage the modes are kept in: the browser's, or a test's. */
export interface FeedModeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's storage when it answers, else null (a private window, a blocked origin). */
export function feedModeStore_default(): FeedModeStore | null {
  try {
    const store: Storage | undefined = globalThis.localStorage;
    if (store === undefined) return null;
    store.getItem(STORE_KEY);
    return store;
  } catch {
    return null;
  }
}

/**
 * The modes this device keeps, each field checked: a value that is not one
 * of its mode's words falls back to the default rather than reaching the scene.
 *
 * @param store - Where they are kept, or null.
 * @returns The modes.
 */
export function feedModes_read(store: FeedModeStore | null): FeedModes {
  let kept: Record<string, unknown> = {};
  try {
    const text: string | null = store?.getItem(STORE_KEY) ?? null;
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') kept = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults.
  }
  const pick = <T extends string>(key: keyof FeedModes, allowed: ReadonlyArray<T>): T =>
    (allowed as ReadonlyArray<unknown>).includes(kept[key]) ? (kept[key] as T) : (FEED_MODES_DEFAULT[key] as T);
  const flag = (key: keyof FeedModes): boolean => (typeof kept[key] === 'boolean' ? (kept[key] as boolean) : (FEED_MODES_DEFAULT[key] as boolean));
  return {
    strategy: pick<LayoutStrategy>('strategy', ['ranked', 'molecule']),
    projection: pick<'3d' | '2d'>('projection', ['3d', '2d']),
    pulse: flag('pulse'),
    metric: pick<MetricMode>('metric', ['time', 'size']),
    hue: pick<HueMode>('hue', ['status', 'compute']),
    census: flag('census'),
    gravity: flag('gravity'),
    draw: pick<DrawMode>('draw', ['spheres', 'stars']),
  };
}

/** Keeps the modes; a store that refuses forgets, and the modes still hold for this page. */
export function feedModes_write(store: FeedModeStore | null, modes: FeedModes): void {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(modes));
  } catch {
    // Refused: forgotten on reload, held for now.
  }
}

/** The verbs a feed frame carries, as a pill's `data-feed-verb` names them. */
export type FeedVerb = 'strategy' | 'projection' | 'pulse' | 'metric' | 'hue' | 'census' | 'gravity' | 'draw';

/** What a pill reads for a mode: the current state, in the frame's words. */
export function feedPill_words(verb: FeedVerb, modes: FeedModes): string {
  switch (verb) {
    case 'strategy': return modes.strategy.toUpperCase();
    case 'projection': return modes.projection.toUpperCase();
    case 'pulse': return modes.pulse ? 'PULSE ON' : 'PULSE OFF';
    case 'metric': return modes.metric === 'time' ? 'TIME' : 'SIZE';
    case 'hue': return modes.hue.toUpperCase();
    case 'census': return modes.census ? 'CENSUS' : 'SHAPE';
    case 'gravity': return modes.gravity ? 'GRAVITY ON' : 'GRAVITY OFF';
    case 'draw': return modes.draw.toUpperCase();
  }
}

/** The modes after one press of a verb's pill. */
export function feedModes_press(verb: FeedVerb, modes: FeedModes): FeedModes {
  switch (verb) {
    case 'strategy': return { ...modes, strategy: modes.strategy === 'ranked' ? 'molecule' : 'ranked' };
    case 'projection': return { ...modes, projection: modes.projection === '3d' ? '2d' : '3d' };
    case 'pulse': return { ...modes, pulse: !modes.pulse };
    case 'metric': return { ...modes, metric: modes.metric === 'time' ? 'size' : 'time' };
    case 'hue': return { ...modes, hue: modes.hue === 'status' ? 'compute' : 'status' };
    case 'census': return { ...modes, census: !modes.census };
    case 'gravity': return { ...modes, gravity: !modes.gravity };
    case 'draw': return { ...modes, draw: modes.draw === 'spheres' ? 'stars' : 'spheres' };
  }
}

/** The pills a mode lights dim when off: a loop or a pull that is not running reads as quiet. */
const DIM_WHEN_OFF: ReadonlySet<FeedVerb> = new Set<FeedVerb>(['pulse', 'gravity']);

/**
 * The compute hues for a feed, from the theme: one cycle of the palette's
 * warm tones, read where the theme seats them, so the RUNS pane and the
 * descent colour the same resource the same.
 *
 * @param model - The feed on stage.
 * @returns Resource to CSS colour.
 */
export function feedHueLegend_of(model: FeedDagModel): Map<string, string> {
  const style: CSSStyleDeclaration = getComputedStyle(document.documentElement);
  const cycle: string[] = ['--harvestgold', '--daybreak', '--orange', '--honey', '--butter', '--october-sunset']
    .map((name: string): string => style.getPropertyValue(name).trim())
    .filter((value: string): boolean => value !== '');
  return hueLegend_build(model, cycle);
}

/** What the frame does to a pane when a mode changes; the pane decides what each means for its scene. */
export interface FeedFrameHooks {
  /**
   * A mode changed. `verb` names it; the pane applies it (a scene call, or
   * a redraw of the feed for the metric and the hue).
   */
  changed: (verb: FeedVerb, modes: FeedModes) => void;
}

/**
 * The feed view's frame over a pane's pills: each pill named by its
 * `data-feed-verb` reads its mode's current state, a press turns the mode,
 * the device remembers, and the pane is told.
 */
export class FeedViewFrame {
  private modes: FeedModes;
  private readonly pills: Map<FeedVerb, HTMLElement> = new Map();

  /**
   * @param root - The frame (or any ancestor) holding the pills.
   * @param hooks - What the pane does on a change.
   * @param store - The device's memory; the browser's by default.
   */
  public constructor(root: HTMLElement | null, private readonly hooks: FeedFrameHooks, private readonly store: FeedModeStore | null = feedModeStore_default()) {
    this.modes = feedModes_read(store);
    for (const pill of root?.querySelectorAll<HTMLElement>('[data-feed-verb]') ?? []) {
      const verb: FeedVerb = pill.dataset['feedVerb'] as FeedVerb;
      this.pills.set(verb, pill);
      pill.addEventListener('click', (): void => this.press(verb));
    }
    this.paint();
  }

  /**
   * Takes the device's memory again and repaints: a door opening a feed
   * asks, so a choice made through the other door (in another pane) stands
   * here too.
   *
   * @returns The modes as remembered.
   */
  public recall(): FeedModes {
    this.modes = feedModes_read(this.store);
    this.paint();
    return this.modes_get();
  }

  /** @returns The modes as they stand. */
  public modes_get(): FeedModes {
    return { ...this.modes };
  }

  /** @returns The pill a verb is carried by, when the frame has one. */
  public pill_of(verb: FeedVerb): HTMLElement | null {
    return this.pills.get(verb) ?? null;
  }

  /**
   * Turns one mode, as a press of its pill does: remembered, painted, and
   * the pane told. The language presses through here too.
   *
   * @param verb - The mode.
   */
  public press(verb: FeedVerb): void {
    this.modes = feedModes_press(verb, this.modes);
    feedModes_write(this.store, this.modes);
    this.paint();
    this.hooks.changed(verb, this.modes_get());
  }

  /**
   * Sets one mode to a value without a press (a scene that refused, a
   * pane that knows better), remembered and painted, the pane not told.
   */
  public set<K extends keyof FeedModes>(key: K, value: FeedModes[K]): void {
    this.modes = { ...this.modes, [key]: value };
    feedModes_write(this.store, this.modes);
    this.paint();
  }

  /** Paints every pill's words and its dim state. */
  public paint(): void {
    for (const [verb, pill] of this.pills) {
      pill.textContent = feedPill_words(verb, this.modes);
      if (DIM_WHEN_OFF.has(verb)) pill.classList.toggle('rail-off', verb === 'pulse' ? !this.modes.pulse : !this.modes.gravity);
    }
  }
}
