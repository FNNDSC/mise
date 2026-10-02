/**
 * @jest-environment jsdom
 *
 * @file The cohort's stage verbs: a GATHER pane opens beside the host with
 * the replay place when there is none and is reused when one stands; the
 * band's cohort goes to the main panel as a pane and the band retracts.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { cohort_wire, type CohortHooks, type CohortModule } from '../../src/app/cohort.js';
import type { HostContext } from '../../src/app/hostContext.js';
import type { LayoutManager } from '../../src/app/layout.js';
import { PanelRoster, paneFactory_register, paneInstance_create, paneInstance_dispose, paneInstances_list, type PaneInstance, type PanelKinds } from '../../src/app/panes.js';
import type { GatherSeries } from '../../src/features/gather/panel.js';

interface Stage {
  shown: string[];
  focused: string[];
  splits: Array<[string, string, string, boolean]>;
  splitAnswer: boolean;
  removed: string[];
}

function layout_make(stage: Stage): LayoutManager {
  return {
    panes_shown: (): string[] => stage.shown,
    focus_set: (id: string): boolean => { stage.focused.push(id); return true; },
    leaf_split: (parent: string, dir: string, child: string, before: boolean): boolean => { stage.splits.push([parent, dir, child, before]); return stage.splitAnswer; },
    mount_remove: (id: string): void => { stage.removed.push(id); },
  } as unknown as LayoutManager;
}

/** A gather panel that only records what it was given. */
function gatherPanel_make(): PanelKinds['gather'] & { added: GatherSeries[]; rendered: number } {
  const panel = { added: [] as GatherSeries[], rendered: 0, series_add(entry: GatherSeries): void { this.added.push(entry); }, render_now(): void { this.rendered += 1; } };
  return panel as unknown as PanelKinds['gather'] & { added: GatherSeries[]; rendered: number };
}

const series: GatherSeries = { kind: 'series', seriesUID: '1.2.3', seriesDescription: 'T1', modality: 'MR' } as unknown as GatherSeries;

beforeEach((): void => {
  for (const instance of paneInstances_list()) paneInstance_dispose(instance.id);
  document.body.innerHTML = '<div id="header-gather"><div class="gather-rows"></div></div>';
});

function host_make(stage: Stage, place: { dir: 'row' | 'col'; before: boolean } | null = null): { module: CohortModule; panels: PanelRoster; births: Array<[string, string, string, boolean]>; spawned: string[] } {
  const panels: PanelRoster = new PanelRoster();
  const births: Array<[string, string, string, boolean]> = [];
  const spawned: string[] = [];
  paneFactory_register('gather', (id: string): PaneInstance => ({ id, kind: 'gather', mount: document.createElement('div') }));
  const hooks: CohortHooks = {
    image_open: async (): Promise<string> => '',
    process_open: (): void => {},
    feed_open: (): void => {},
    ask_onPane: async (): Promise<string | null> => null,
    errandHost_find: (): string | null => 'files',
    instance_spawn: (): PaneInstance => {
      // The host's spawn builds the pane and files its panel, as the real one does.
      const instance: PaneInstance = paneInstance_create('gather');
      panels.set('gather', instance.id, gatherPanel_make());
      spawned.push(instance.id);
      return instance;
    },
    birth_record: (childId: string, parent: string, dir: 'row' | 'col', before: boolean): void => { births.push([childId, parent, dir, before]); },
    replayPlace_get: () => place,
    stage_relight: (): void => {},
    home_apply: (): void => {},
    orphans_dispose: (): void => {},
    fileText_fetch: async () => ({ ok: false, text: '' }),
    template_stamp: (): HTMLElement => document.createElement('div'),
    pane_find: (mount: HTMLElement, selector: string): HTMLElement => mount.querySelector(selector) ?? document.createElement('div'),
    element_require: (id: string): HTMLElement => document.getElementById(id) as HTMLElement,
  };
  const context = { layout: layout_make(stage), panels, subjects: { pane_leave: (): void => {} }, terminal: {}, client: {} } as unknown as Pick<HostContext, 'layout' | 'panels' | 'subjects' | 'terminal' | 'client'>;
  return { module: cohort_wire(context, hooks), panels, births, spawned };
}

describe('cohort_wire', () => {
  it('opens a GATHER pane beside the host, at the replay place, and records its birth', () => {
    const stage: Stage = { shown: ['pacs'], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module, panels, births, spawned } = host_make(stage, { dir: 'col', before: true });
    const id: string | null = module.open([series], 'pacs');
    expect(id).toBe(spawned[0]);
    expect(stage.splits).toEqual([['pacs', 'col', id, true]]);
    expect(births).toEqual([[id, 'pacs', 'col', true]]);
    expect((panels.get('gather', id as string) as unknown as { added: GatherSeries[] }).added).toEqual([series]);
  });

  it('falls to the row-after default and the errand host when the asked host is not on stage', () => {
    const stage: Stage = { shown: ['files'], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module } = host_make(stage);
    const id: string | null = module.open([series], 'pacs');
    expect(stage.splits[0]).toEqual(['files', 'row', id, false]);
  });

  it('reuses the GATHER pane on stage, and lets a refused split go', () => {
    const stage: Stage = { shown: ['pacs', 'gather-9'], focused: [], splits: [], splitAnswer: false, removed: [] };
    const { module, panels } = host_make(stage);
    const standing = gatherPanel_make();
    panels.set('gather', 'gather-9', standing);
    expect(module.open([series])).toBe('gather-9');
    expect(standing.added).toEqual([series]);
    expect(stage.splits).toEqual([]);
    // No pane on stage and the split refused: the spawned pane is let go, nothing opened.
    stage.shown = ['pacs'];
    expect(module.open([series])).toBeNull();
    expect(stage.removed.length).toBe(1);
  });

  it('stages the cohort as a pane split from the errand host, and the band retracts', () => {
    const stage: Stage = { shown: ['files'], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module, panels, births, spawned } = host_make(stage);
    module.stage();
    expect(stage.splits).toEqual([['files', 'col', spawned[0], false]]);
    expect(births).toEqual([[spawned[0], 'files', 'col', false]]);
    expect((panels.get('gather', spawned[0] as string) as unknown as { rendered: number }).rendered).toBe(1);
    expect(document.body.dataset['header']).toBe('away');
    // A GATHER pane already on stage is focused instead.
    stage.shown = ['files', spawned[0] as string];
    module.stage();
    expect(stage.focused).toEqual([spawned[0]]);
    expect(stage.splits.length).toBe(1);
  });

  it('holds nothing until something is gathered', () => {
    const stage: Stage = { shown: [], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module } = host_make(stage);
    expect(module.has('1.2.3')).toBe(false);
    expect(module.cohort.size()).toBe(0);
  });
});
