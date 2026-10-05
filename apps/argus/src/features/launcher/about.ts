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
    text: 'Every analysis you can see, drawn as a galaxy you can fly through. Analyses that ran the same pipeline cluster together, and failures glow red. Rearrange the space to ask different questions:',
    list: [
      'GALAXY: grouped by pipeline (the default)',
      'SPOKES · CLUMPS: the same groups, tidier',
      'CONSTELLATIONS: grouped by the tools they used',
      'DATA: hung from the data they began with (format, modality, series)',
      'ACCRETION: grown oldest-first, like next to like',
    ],
    tail: 'Replay its history, or fly in to any one analysis to see its steps.',
  },
  analyses: {
    text: 'Your analyses (ChRIS "feeds"), newest first. Each is a chain of processing steps run on your data. Open one to follow its progress, read its logs and browse what it made.',
  },
  files: {
    text: 'Your ChRIS home folder: uploads, results and anything shared with you. Browse, preview images and text, download, or send files into an analysis.',
  },
  pacs: {
    text: 'Find imaging studies in the hospital PACS by patient, accession number or date. Pull the series you need into ChRIS, ready to analyse.',
  },
  panes: {
    text: 'Saved workspaces. A desktop remembers which views you had open and how they were arranged, so you can return to a piece of work as you left it.',
  },
  keys: {
    text: 'Keyboard shortcuts, and the commands ARGUS understands. Everything you can click can also be typed.',
  },
  notes: {
    text: 'A list of updates since the previous release.',
  },
  console: {
    text: 'A command line into the same session. Type help to start. Anything done here shows up in the panes, and the other way round.',
  },
};
