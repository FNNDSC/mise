/**
 * @jest-environment jsdom
 */
/**
 * @file The dashboard's tiles: the frame's own, and a composition's placed
 * among them, its lead taking the wide seat when it has more to say than home.
 */
import { describe, it, expect } from '@jest/globals';
import { dashboardTiles_build, type DashboardHooks, type TileContribution } from '../../src/app/dashboardTiles.js';
import type { LauncherTile } from '../../src/features/launcher/panel.js';
import type { ExecuteOutcome } from '../../src/calypso/client.js';

/** A home listing of so many entries. */
const home = (entries: number): ExecuteOutcome => ({
  envelopes: [{ status: 'ok', rendered: '', model: { kind: 'fs.listing', data: [{ path: '/home/u', items: Array.from({ length: entries }, (_, i) => ({ name: `e${i}`, type: 'dir' })) }] } }],
} as unknown as ExecuteOutcome);

/** The hooks, with a composition's tiles or none. */
const hooks = (entries: number, contribution?: () => Promise<TileContribution>): DashboardHooks => ({
  ask: async () => home(entries),
  home_open: () => undefined, home_cd: () => undefined, desktops: () => [], desktop_restore: () => undefined,
  panes_open: () => undefined, keys_open: () => undefined, notes_open: () => undefined,
  notes_latest: async () => null, daemon_stale: () => false, console_open: () => undefined,
  ...(contribution !== undefined ? { contribution } : {}),
});
const tile = (key: string): LauncherTile => ({ key, name: key.toUpperCase(), hue: '--butter', numeral: '', figures: [], rows: [], verb: '', about: '', enter: () => undefined } as LauncherTile);
const keys = (tiles: ReadonlyArray<LauncherTile>): string[] => tiles.map((t) => t.key);

describe('the dashboard tiles', () => {
  it('are the frame\'s alone with no composition, FILES in the wide seat', async () => {
    expect(keys(await dashboardTiles_build(hooks(3))())).toEqual(['files', 'panes', 'help', 'notes', 'console']);
  });

  it('place a composition\'s tiles after FILES and after PANES, its lead in the wide seat when it outweighs home', async () => {
    const contribution = (weight: number) => async (): Promise<TileContribution> => ({ lead: { tile: tile('analyses'), weight }, afterFiles: [tile('pacs')], afterPanes: [tile('universe')] });
    expect(keys(await dashboardTiles_build(hooks(3, contribution(10)))())).toEqual(['analyses', 'files', 'pacs', 'panes', 'universe', 'help', 'notes', 'console']);
    expect(keys(await dashboardTiles_build(hooks(30, contribution(10)))())).toEqual(['files', 'analyses', 'pacs', 'panes', 'universe', 'help', 'notes', 'console']);
  });
});
