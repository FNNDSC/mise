/**
 * @jest-environment jsdom
 *
 * @file The PANES card grid: one card per dormant group, press to restore,
 * DISMISS to forget. The panel holds no state — it draws the set it is given.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { PanesPanel } from '../../src/features/panes/panel';
import type { GroupSnapshot } from '../../src/app/dormant';

function mount_make(): HTMLElement {
  document.body.innerHTML = '';
  const mount = document.createElement('div');
  mount.innerHTML = '<div class="panes-grid"></div><div class="panes-empty" hidden></div>';
  document.body.appendChild(mount);
  return mount;
}

function snap(id: string, extra: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return { id, label: id, regard: { address: id, modelKind: 'dicom.series' }, members: ['viewer'], lastTouched: 1, ...extra };
}

let restored: string[];
let dismissed: string[];
let groups: GroupSnapshot[];

function panel_make(): PanesPanel {
  return new PanesPanel(mount_make(), {
    list: (): GroupSnapshot[] => groups,
    restore: (id: string): void => { restored.push(id); },
    dismiss: (id: string): void => { dismissed.push(id); groups = groups.filter((g): boolean => g.id !== id); },
  });
}

beforeEach(() => { restored = []; dismissed = []; groups = []; });

describe('PanesPanel', () => {
  it('draws one card per group with label, badges and a thumbnail when present', () => {
    groups = [snap('/s/a', { label: 'T1 SAG · MR', members: ['viewer', 'tags'], thumbnail: 'data:image/png;base64,AAAA' })];
    const panel = panel_make();
    panel.render();
    const grid = document.querySelector('.panes-grid') as HTMLElement;
    expect(grid.querySelectorAll('.panes-card')).toHaveLength(1);
    expect(grid.querySelector('.panes-card-label')?.textContent).toBe('T1 SAG · MR');
    expect([...grid.querySelectorAll('.panes-card-badge')].map((b): string | null => b.textContent)).toEqual(['VIEWER', 'TAGS']);
    expect(grid.querySelector('.panes-card-figure img')).not.toBeNull();
  });

  it('shows a glyph, not an image, when a group has no thumbnail', () => {
    groups = [snap('/s/a')];
    const panel = panel_make();
    panel.render();
    expect(document.querySelector('.panes-card-figure img')).toBeNull();
    expect(document.querySelector('.panes-card-glyph')?.textContent).toBe('▣');
  });

  it('shows the empty note when nothing is dormant', () => {
    const panel = panel_make();
    panel.render();
    expect((document.querySelector('.panes-empty') as HTMLElement).hidden).toBe(false);
    expect(document.querySelectorAll('.panes-card')).toHaveLength(0);
  });

  it('restores the whole group when its card is pressed', () => {
    groups = [snap('/s/a'), snap('/s/b')];
    const panel = panel_make();
    panel.render();
    (document.querySelectorAll('.panes-card')[1] as HTMLElement).click();
    expect(restored).toEqual(['/s/b']);
  });

  it('forgets a group on DISMISS without restoring it, and redraws', () => {
    groups = [snap('/s/a')];
    const panel = panel_make();
    panel.render();
    (document.querySelector('.panes-card-dismiss') as HTMLElement).click();
    expect(dismissed).toEqual(['/s/a']);
    expect(restored).toEqual([]);
    expect(document.querySelectorAll('.panes-card')).toHaveLength(0);
  });
});
