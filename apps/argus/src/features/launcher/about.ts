/**
 * @file What each dashboard tile says it is, in plain words.
 *
 * The dashboard is the first thing a new user sees, alone on the screen. A
 * tile's name and figures say what it holds to someone who already knows
 * ChRIS; these lines say what it is for to someone who does not. The words
 * were approved by the operator; change them with the operator.
 *
 * @module
 */

/** A tile's description: a paragraph, and optionally a short list under it. */
export interface TileAbout {
  /** What the tile is for, in a sentence or three. */
  text: string;
  /** Named choices the tile offers, each `NAME: what it does`. */
  list?: ReadonlyArray<string>;
  /** A closing sentence after the list. */
  tail?: string;
}

/** The descriptions, by tile key. */
export const TILE_ABOUT: Readonly<Record<string, TileAbout>> = {
  universe: {
    text: 'Every analysis, drawn as a galaxy. Alike analyses cluster; failures glow red. Rearrange it:',
    list: [
      'GALAXY: grouped by pipeline (the default)',
      'SPOKES · CLUMPS: the same groups, tidier',
      'CONSTELLATIONS: grouped by the tools they used',
      'DATA: hung from the data they began with (format, modality, series)',
      'ACCRETION: grown oldest-first, like next to like',
    ],
    tail: 'Replay its history, or fly in to any one analysis to see its steps.',
  },
  // The stratus composition's (compositions/stratus/tiles.ts); approved by the operator 2026-10-22.
  domains: {
    text: 'The Trusted Domains in this tenancy, found by their tag: each one\'s condition or last finished build step, its address and what it costs per hour. One with a step gone wrong shows in red; one torn down reads GONE until what is left of it is removed. Opening the tile, or a Trusted Domain on it, opens the TD controller: its condition, spec, steps and cost, and the lines that build, verify and tear it down.',
  },
  capacity: {
    text: 'What this region has free for the machine families your domains use, zone by zone: the cores and memory a new domain or a bigger one could take.',
  },
  analyses: {
    text: 'Your analyses, newest first. Open one to follow it, read its logs and browse its results.',
  },
  // The frame's own home; a composition says what its home holds (ChRIS: compositions/chris/tiles.ts).
  files: {
    text: 'Your home: the files this session holds.',
  },
  pacs: {
    text: 'Find studies in the hospital PACS and pull the series you need into ChRIS.',
  },
  panes: {
    text: 'Saved workspaces: return to a piece of work as you left it.',
  },
  keys: {
    text: 'Keyboard shortcuts and the commands ARGUS understands.',
  },
  notes: {
    text: 'A list of updates since the previous release.',
  },
  console: {
    text: 'A command line into the same session; what you do here shows in the panes, and the other way round.',
  },
};
