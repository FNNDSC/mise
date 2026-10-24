/**
 * @jest-environment jsdom
 *
 * @file The cohort's stage verbs: a GATHER pane opens beside the host with
 * the replay place when there is none and is reused when one stands; the
 * band's cohort goes to the main panel as a pane and the band retracts.
 * And the cohort is the kernel's: a press sends `gather add`, and what the
 * views show is the `gather.cohort` model the kernel answers with.
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
function gatherPanel_make(): PanelKinds['gather'] & { rendered: number } {
  const panel = { rendered: 0, render_now(): void { this.rendered += 1; } };
  return panel as unknown as PanelKinds['gather'] & { rendered: number };
}

const series: GatherSeries = { kind: 'series', seriesUID: '1.2.3', description: 'T1', modality: 'MR', vfsPath: '/net/pacs/queries/q_qid:7/Study_1.2/Series_1.2.3_T1' } as unknown as GatherSeries;

/** The kernel's answer to a gather verb: the whole cohort. */
function cohortEnvelope(series: Array<Record<string, unknown>>, name: string | null = null): { status: string; model: { kind: string; data: unknown } } {
  return { status: 'ok', model: { kind: 'gather.cohort', data: { version: 1, name, feed: null, series } } };
}

/** Lines the fake session ran, and what it answers each with. */
interface Wire {
  lines: string[];
  /** Lines sent as a pane's housekeeping rather than the operator's act. */
  housekeeping: string[];
  echoed: string[];
  written: number;
  answer: (line: string) => Array<Record<string, unknown>>;
}

/** Lets the presses of one tick reach the wire. */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach((): void => {
  for (const instance of paneInstances_list()) paneInstance_dispose(instance.id);
  // The band's own markup (index.html), since a press builds the band's panel.
  document.body.innerHTML = [
    '<div class="header-face" id="header-gather">',
    '<div class="gather-listing header-gather-field" data-frame-host>',
    '<span class="field-rule"></span><button class="mode-strip"></button><span class="mode-elbow"></span>',
    '<aside class="mode-frame">',
    '<button class="strategy-pill gather-filter rail-off">FILTER OFF</button>',
    '<button class="strategy-pill gather-columns rail-off">COLUMNS</button>',
    '<button class="strategy-pill gather-pull" hidden>PULL</button>',
    '<button class="strategy-pill gather-remove" hidden>CLEAR</button>',
    '<button class="strategy-pill gather-process" hidden>PROCESS</button>',
    '<button class="strategy-pill gather-stage">ON STAGE</button>',
    '<span class="mode-fill"></span></aside>',
    '<div class="gather-rows"></div></div>',
    '<span class="pane-state gather-state"></span>',
    '</div>',
  ].join('');
});

function host_make(stage: Stage, place: { dir: 'row' | 'col'; before: boolean } | null = null, wire: Wire = { lines: [], housekeeping: [], echoed: [], written: 0, answer: () => [] }): { module: CohortModule; panels: PanelRoster; births: Array<[string, string, string, boolean]>; spawned: string[]; wire: Wire } {
  const panels: PanelRoster = new PanelRoster();
  const births: Array<[string, string, string, boolean]> = [];
  const spawned: string[] = [];
  paneFactory_register('gather', (id: string): PaneInstance => ({ id, kind: 'gather', mount: document.createElement('div') }));
  const hooks: CohortHooks = {
    image_open: async (): Promise<string> => '',
    process_open: (): void => {},
    feed_open: (): void => {},
    askOnPane_await: async (): Promise<string | null> => null,
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
    template_stamp: (): HTMLElement => document.createElement('div'),
    pane_find: (mount: HTMLElement, selector: string): HTMLElement => mount.querySelector(selector) ?? document.createElement('div'),
    element_require: (id: string): HTMLElement => document.getElementById(id) as HTMLElement,
  };
  const terminal = {
    line_echo: (line: string): void => { wire.echoed.push(line); },
    outcome_write: (): void => { wire.written += 1; },
    output_write: (): void => {},
    line_note: (): void => {},
  };
  const client = {
    line_execute: async (line: string, options?: { operator?: boolean }): Promise<{ envelopes: unknown[] }> => {
      wire.lines.push(line);
      if (options?.operator !== true) wire.housekeeping.push(line);
      return { envelopes: wire.answer(line) };
    },
  };
  const context = { layout: layout_make(stage), panels, subjects: { pane_leave: (): void => {} }, terminal, client } as unknown as Pick<HostContext, 'layout' | 'panels' | 'subjects' | 'terminal' | 'client'>;
  return { module: cohort_wire(context, hooks), panels, births, spawned, wire };
}

describe('cohort_wire', () => {
  it('opens a GATHER pane beside the host, at the replay place, records its birth, and gathers by the kernel\'s verb', async () => {
    const stage: Stage = { shown: ['pacs'], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module, births, spawned, wire } = host_make(stage, { dir: 'col', before: true });
    const id: string | null = module.open([series], 'pacs');
    expect(id).toBe(spawned[0]);
    expect(stage.splits).toEqual([['pacs', 'col', id, true]]);
    expect(births).toEqual([[id, 'pacs', 'col', true]]);
    await tick();
    expect(wire.lines).toEqual([`gather add '${series.vfsPath}'`]);
    expect(wire.echoed).toEqual(wire.lines);
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

  it('sends one gather add for every press in one tick, a study\'s series at once', async () => {
    const stage: Stage = { shown: [], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module, wire } = host_make(stage);
    module.gather([series]);
    module.gather([{ ...series, seriesUID: '1.2.4', vfsPath: '/net/pacs/queries/q_qid:7/Study_1.2/Series_1.2.4_FLAIR' }]);
    module.gather([series]);
    await tick();
    expect(wire.lines).toEqual([`gather add '${series.vfsPath}' '/net/pacs/queries/q_qid:7/Study_1.2/Series_1.2.4_FLAIR'`]);
    // A press is the operator's act, never a pane's housekeeping: other surfaces hear it, and it may ask.
    expect(wire.housekeeping).toEqual([]);
  });

  it('shows what the kernel answered, not what was pressed', async () => {
    const stage: Stage = { shown: [], focused: [], splits: [], splitAnswer: true, removed: [] };
    const answered = [{ vfsPath: series.vfsPath, kind: 'series', seriesUID: '1.2.3', description: 'SAG T1', modality: 'MR', patient: '4455667', study: 'MR Brain' }];
    const { module } = host_make(stage, null, { lines: [], housekeeping: [], echoed: [], written: 0, answer: () => [cohortEnvelope(answered, 'sag')] });
    module.gather([series]);
    // Nothing shows on the press itself.
    expect(module.cohort.size()).toBe(0);
    await tick();
    expect(module.has('1.2.3')).toBe(true);
    expect(module.cohort.name_get()).toBe('sag');
    expect(module.cohort.members_get()[0]).toEqual(expect.objectContaining({ description: 'SAG T1', patient: '4455667', study: 'MR Brain' }));
  });

  it('redraws from a cohort another line answered with, and keys a place by its path', () => {
    const stage: Stage = { shown: [], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module } = host_make(stage);
    module.envelope_observe(cohortEnvelope([{ vfsPath: '/home/chris/uploads/brain', kind: 'dir' }]) as never);
    expect(module.has('/home/chris/uploads/brain')).toBe(true);
    expect(module.cohort.members_get()[0]).toEqual(expect.objectContaining({ kind: 'dir', description: 'brain' }));
    module.envelope_observe(cohortEnvelope([]) as never);
    expect(module.cohort.size()).toBe(0);
  });

  it('writes a refusal, and keeps a quiet press quiet', async () => {
    const stage: Stage = { shown: [], focused: [], splits: [], splitAnswer: true, removed: [] };
    const wire: Wire = { lines: [], housekeeping: [], echoed: [], written: 0, answer: () => [] };
    const { module } = host_make(stage, null, wire);
    module.gather([series]);
    await tick();
    expect(wire.written).toBe(0);
    wire.answer = () => [{ status: 'error' }];
    module.gather([series]);
    await tick();
    expect(wire.written).toBe(1);
  });

  it('asks the kernel for the cohort at boot', async () => {
    const stage: Stage = { shown: [], focused: [], splits: [], splitAnswer: true, removed: [] };
    const { module, wire } = host_make(stage, null, { lines: [], housekeeping: [], echoed: [], written: 0, answer: () => [cohortEnvelope([{ vfsPath: series.vfsPath, kind: 'series', seriesUID: '1.2.3' }])] });
    await module.restore();
    expect(wire.lines).toEqual(['gather']);
    expect(wire.echoed).toEqual([]);
    expect(module.has('1.2.3')).toBe(true);
  });
});
