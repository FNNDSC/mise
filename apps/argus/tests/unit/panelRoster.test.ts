/**
 * @file The panel roster: one registry for every kind, filed by pane id,
 * read by kind.
 */
import { describe, it, expect } from '@jest/globals';
import { PanelRoster, type PanelKinds } from '../../src/app/panes.js';

/** Stand-ins: the roster never calls a panel, it only files it. */
const filesA = { name: 'filesA' } as unknown as PanelKinds['files'];
const filesB = { name: 'filesB' } as unknown as PanelKinds['files'];
const dagA = { name: 'dagA' } as unknown as PanelKinds['dag'];

describe('PanelRoster', () => {
  it('files by pane id and reads by kind', () => {
    const roster: PanelRoster = new PanelRoster();
    roster.set('files', 'files', filesA);
    roster.set('files', 'files-3', filesB);
    roster.set('dag', 'dag', dagA);
    expect(roster.get('files', 'files')).toBe(filesA);
    expect(roster.get('dag', 'dag')).toBe(dagA);
    // A pane id filed under one kind answers nothing for another.
    expect(roster.get('dag', 'files')).toBeUndefined();
    expect(roster.has('files', 'files-3')).toBe(true);
    expect(roster.has('dag', 'files-3')).toBe(false);
    expect(roster.ids('files')).toEqual(['files', 'files-3']);
    expect(roster.values('files')).toEqual([filesA, filesB]);
    expect(roster.entries('dag')).toEqual([['dag', dagA]]);
    expect(roster.ids('image')).toEqual([]);
  });

  it('finds the id a panel is filed under', () => {
    const roster: PanelRoster = new PanelRoster();
    roster.set('files', 'files-7', filesB);
    expect(roster.idOf('files', filesB)).toBe('files-7');
    expect(roster.idOf('files', filesA)).toBeNull();
  });

  it('strikes a pane id whatever its kind', () => {
    const roster: PanelRoster = new PanelRoster();
    roster.set('files', 'files-1', filesA);
    expect(roster.delete('files-1')).toBe(true);
    expect(roster.delete('files-1')).toBe(false);
    expect(roster.get('files', 'files-1')).toBeUndefined();
  });

  it('refiles a pane id under a new kind', () => {
    const roster: PanelRoster = new PanelRoster();
    roster.set('files', 'x', filesA);
    roster.set('dag', 'x', dagA);
    expect(roster.get('files', 'x')).toBeUndefined();
    expect(roster.get('dag', 'x')).toBe(dagA);
  });
});
