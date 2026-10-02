/**
 * @jest-environment jsdom
 *
 * @file The desktop: a stage of content is captured as an action log with
 * its shape, keyed and labelled; a bare domain is not carded; a restore
 * replays the log through the host's open verbs with the replay place set,
 * each open from the pane a prior action produced, and lays the shape over
 * what came back.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { desktop_wire, type Desktop, type DesktopHooks, type ReplayPlace } from '../../src/app/desktop.js';
import type { DormantRegistry, GroupSnapshot } from '../../src/app/dormant.js';
import type { LayoutManager, LayoutNode } from '../../src/app/layout.js';
import { PanelRoster, paneFactory_register, paneInstance_adopt, paneInstance_create, paneInstance_dispose, paneInstances_list, type PaneInstance, type PanelKinds } from '../../src/app/panes.js';
import type { ArgusTerminal } from '../../src/console/terminal.js';

/** A stage: which panes are shown, the preset, the tree, what was focused and swept. */
interface Stage {
  shown: string[];
  preset: string;
  tree: LayoutNode | null;
  focused: string[];
  presets: string[];
  removed: string[];
  setTree: LayoutNode | null;
}

function layout_make(stage: Stage): LayoutManager {
  return {
    panes_shown: (): string[] => stage.shown,
    activePreset_get: (): string => stage.preset,
    tree_get: (): LayoutNode | null => stage.tree,
    tree_set: (tree: LayoutNode): void => { stage.setTree = tree; },
    focus_set: (id: string): boolean => { stage.focused.push(id); return true; },
    preset_apply: (preset: string): void => { stage.presets.push(preset); stage.preset = preset; },
    mount_remove: (id: string): void => { stage.removed.push(id); },
  } as unknown as LayoutManager;
}

function dormant_make(): { dormant: DormantRegistry; added: GroupSnapshot[]; kept: Map<string, GroupSnapshot> } {
  const added: GroupSnapshot[] = [];
  const kept: Map<string, GroupSnapshot> = new Map();
  const dormant = {
    add: (snapshot: GroupSnapshot): void => { added.push(snapshot); kept.set(snapshot.id, snapshot); },
    get: (id: string): GroupSnapshot | undefined => kept.get(id),
    dismiss: (id: string): boolean => kept.delete(id),
  } as unknown as DormantRegistry;
  return { dormant, added, kept };
}

/** Panes stand in the registry the module reads; each test clears them. */
function pane_make(kind: 'files' | 'tags' | 'image' | 'empty' | 'view'): PaneInstance {
  paneFactory_register(kind, (id: string): PaneInstance => ({ id, kind, mount: document.createElement('div') }));
  return paneInstance_create(kind);
}

function files_make(path: string | null): PanelKinds['files'] {
  return { path_current: (): string | null => path, commandLine_get: (): string => '', commandLine_set: (): void => {} } as unknown as PanelKinds['files'];
}

beforeEach((): void => {
  for (const instance of paneInstances_list()) paneInstance_dispose(instance.id);
  document.body.innerHTML = '';
});

describe('desktop_wire', () => {
  function host_make(stage: Stage, hooks: Partial<DesktopHooks> = {}): { desktop: Desktop; panels: PanelRoster; dormant: ReturnType<typeof dormant_make>; lines: string[]; places: Array<ReplayPlace | null> } {
    const panels: PanelRoster = new PanelRoster();
    const dormant = dormant_make();
    const lines: string[] = [];
    const places: Array<ReplayPlace | null> = [];
    const terminal = { line_run: (line: string): void => { lines.push(line); } } as unknown as ArgusTerminal;
    let desktop: Desktop;
    const all: DesktopHooks = {
      image_open: async (): Promise<string> => 'image',
      dir_open: (): void => { places.push(desktop.replayPlace_get()); },
      process_open: (): void => {},
      gather_open: (): string | null => null,
      feed_open: (): void => {},
      pillPane_spawn: (): string | null => null,
      pacsQuery_get: (): string | null => null,
      catalogue_of: (): undefined => undefined,
      catalogueIds: (): string[] => [],
      stage_relight: (): void => {},
      ...hooks,
    };
    desktop = desktop_wire({
      layout: layout_make(stage), panels, paneInstance_get: (id: string): PaneInstance | undefined => paneInstances_list().find((one: PaneInstance): boolean => one.id === id), dormant: dormant.dormant, terminal,
    }, all);
    return { desktop, panels, dormant, lines, places };
  }

  it('does not card a bare domain, the launcher or PANES', () => {
    // The primary stands under its own name; a bare domain is one gutter press away.
    const files: PaneInstance = { id: 'files', kind: 'files', mount: document.createElement('div') };
    paneInstance_adopt(files);
    const stage: Stage = { shown: [files.id], preset: 'files', tree: { pane: files.id }, focused: [], presets: [], removed: [], setTree: null };
    const { desktop, panels, dormant } = host_make(stage);
    panels.set('files', files.id, files_make('/home'));
    desktop.capture();
    stage.preset = 'launcher';
    desktop.capture();
    expect(dormant.added).toEqual([]);
  });

  it('captures content as an action log with its births and shape, keyed by its content', () => {
    const files: PaneInstance = pane_make('files');
    const second: PaneInstance = pane_make('files');
    const tags: PaneInstance = pane_make('tags');
    const tree: LayoutNode = { dir: 'col', ratio: 0.5, first: { pane: files.id }, second: { dir: 'row', ratio: 0.3, first: { pane: tags.id }, second: { pane: second.id } } };
    const stage: Stage = { shown: [files.id, second.id, tags.id], preset: 'files', tree, focused: [], presets: [], removed: [], setTree: null };
    const { desktop, panels, dormant } = host_make(stage);
    // The primary is 'files' by id; the registry minted another name, so stand it in as a browser at /data.
    panels.set('files', files.id, files_make('/data'));
    panels.set('files', second.id, files_make('/data/sub'));
    desktop.birth_record(second.id, files.id, 'col', false);
    desktop.birth_record(tags.id, second.id, 'row', true);
    desktop.capture();
    expect(dormant.added.length).toBe(1);
    const card: GroupSnapshot = dormant.added[0] as GroupSnapshot;
    expect(card.actions).toEqual([
      { op: 'dir', path: '/data', target: 0, dir: 'col', side: 'after' },
      { op: 'dir', path: '/data/sub', target: 0, dir: 'col', side: 'after' },
      { op: 'tags', target: 1, dir: 'row', side: 'before' },
    ]);
    expect(card.members).toEqual(['files', 'tags']);
    expect(card.id).toBe('files:/data|/data/sub|tags');
    expect(card.label).toBe('data');
    expect(card.regard).toEqual({ address: card.id, modelKind: 'argus.desktop' });
    expect(card.shape).toEqual({ dir: 'col', ratio: 0.5, first: { leaf: 0 }, second: { dir: 'row', ratio: 0.3, first: { leaf: 2 }, second: { leaf: 1 } } });
    // Capture is suppressed while a replay is in flight, and the primaries survive a sweep.
    expect(desktop.replaying()).toBe(false);
  });

  it('a domain switch captures first, applies the preset, then sweeps split-born panes', () => {
    const files: PaneInstance = pane_make('files');
    const orphan: PaneInstance = pane_make('tags');
    const stage: Stage = { shown: [files.id], preset: 'files', tree: { pane: files.id }, focused: [], presets: [], removed: [], setTree: null };
    let relit: number = 0;
    const { desktop } = host_make(stage, { stage_relight: (): void => { relit += 1; } });
    desktop.domain_enter('pacs');
    expect(stage.presets).toEqual(['pacs']);
    expect(stage.removed).toEqual([orphan.id]);
    expect(paneInstances_list().map((one: PaneInstance): string => one.id)).toEqual([files.id]);
    expect(relit).toBe(1);
  });

  it('a restore replays each open from the pane a prior action produced, with the replay place set, and lays the shape over them', async () => {
    const files: PaneInstance = pane_make('files');
    const stage: Stage = { shown: [files.id], preset: 'panes', tree: null, focused: [], presets: [], removed: [], setTree: null };
    const opened: string[] = [];
    const { desktop, dormant, lines, places } = host_make(stage, {
      dir_open: (path: string): void => {
        // The host opens a browser: a new files pane stands on stage.
        const pane: PaneInstance = pane_make('files');
        stage.shown = [...stage.shown, pane.id];
        opened.push(pane.id);
        places.push(desktop.replayPlace_get());
        void path;
      },
    });
    dormant.kept.set('card', {
      id: 'card', label: 'x', regard: { address: 'card', modelKind: 'argus.desktop' }, members: ['files'],
      actions: [
        { op: 'domain', domain: 'files' },
        { op: 'dir', path: '/a', target: 0, dir: 'col', side: 'after' },
        { op: 'dir', path: '/b', target: 1, dir: 'row', side: 'before' },
        { op: 'tags', target: 2 },
      ],
      shape: { dir: 'col', ratio: 0.4, first: { leaf: 0 }, second: { dir: 'row', ratio: 0.5, first: { leaf: 2 }, second: { leaf: 1 } } },
      lastTouched: 0,
    } as GroupSnapshot);
    await desktop.restore('card');
    expect(stage.presets).toEqual(['files']);
    expect(places).toEqual([{ dir: 'col', before: false }, { dir: 'row', before: true }]);
    expect(desktop.replayPlace_get()).toBeNull();
    // The second browser opened FROM the first one replayed; tags from the second.
    expect(stage.focused).toEqual(['files', opened[0], opened[1]]);
    expect(lines).toEqual(['image tags']);
    // No tags pane came back, so its leaf is left out of the shape.
    expect(stage.setTree).toEqual({ dir: 'col', ratio: 0.4, first: { pane: 'files' }, second: { dir: 'row', ratio: 0.5, first: { pane: opened[1] }, second: { pane: opened[0] } } });
    expect(dormant.kept.has('card')).toBe(false);
    expect(desktop.replaying()).toBe(false);
  });
});
