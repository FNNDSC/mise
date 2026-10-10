/**
 * @file The ChRIS composition's stage: the panes it raises whole (RUNS, the
 * UNIVERSE, PACS), the presets that raise them, and the panes it can split
 * in beside the frame's (RUNS, the universe, DICOM images and tags, GATHER).
 *
 * @module
 */
import type { LayoutNode } from '../../app/layout.js';
import type { PaneInstance, PaneKind } from '../../app/panes.js';
import type { ChrisPanes } from './panes.js';
import type { ChrisDicom } from './dicom.js';

/** What the composition puts on the frame's stage. */
export interface ChrisStage {
  /** The panes it raises whole, built once and kept: RUNS, the UNIVERSE, PACS. */
  primaries: ReadonlyArray<PaneInstance>;
  /** Those that never go dormant and are no card in PANES (RUNS and PACS; the universe is a stage, not a domain). */
  domains: ReadonlyArray<string>;
  /** The presets that give each the whole workspace. */
  presets: ReadonlyArray<[string, () => LayoutNode]>;
  /** The panes it splits in, by kind. */
  factories: ReadonlyArray<[PaneKind, (id: string) => PaneInstance]>;
}

/**
 * Makes the ChRIS stage.
 *
 * @param parts - Its builders, and the PACS workspace the page carries.
 * @returns The stage.
 */
export function chrisStage_make(parts: {
  panes: ChrisPanes;
  dicom: Pick<ChrisDicom, 'imageInstance_build' | 'tagsInstance_build'>;
  gather_build: (id: string) => PaneInstance;
  pacsMount: HTMLElement;
}): ChrisStage {
  return {
    primaries: [
      parts.panes.dag_build('dag', true),
      // The UNIVERSE is a stage of its own, like RUNS or PACS: one primary
      // pane the layout raises whole. Split beside a browser it read as a
      // fragment of a workspace, and the browser had to be closed to see the space.
      parts.panes.universe_build('universe'),
      { id: 'pacs', kind: 'pacs', mount: parts.pacsMount },
    ],
    domains: ['dag', 'pacs'],
    presets: [
      // PACS-03, RUNS-02 and the UNIVERSE each own the whole workspace, not a split variation.
      ['pacs', (): LayoutNode => ({ pane: 'pacs' })],
      ['dag', (): LayoutNode => ({ pane: 'dag' })],
      ['universe', (): LayoutNode => ({ pane: 'universe' })],
    ],
    factories: [
      ['dag', (id: string): PaneInstance => parts.panes.dag_build(id, false)],
      ['universe', parts.panes.universe_build],
      ['image', parts.dicom.imageInstance_build],
      ['tags', parts.dicom.tagsInstance_build],
      ['gather', parts.gather_build],
    ],
  };
}
