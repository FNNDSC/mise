/**
 * @file The NOTES pane's rows: one block per release, a row per headline,
 * the rest beneath an unfolded one; and the model read off an outcome.
 */
import { describe, it, expect } from '@jest/globals';
import type { SessionNotes } from '@fnndsc/menu';
import { notesBlocks_build, release_title } from '../../src/features/notes/panel.js';
import { notesModel_of } from '../../src/app/notesPane.js';

const MODEL: SessionNotes = {
  source: 'daemon',
  installed: { argus: '0.24.1', brasa: '0.32.1' },
  total: 3,
  all: false,
  releases: [
    { date: '2026-10-05', merge: 'f194de9c', entries: [
      { package: 'argus', version: '0.24.1', bump: 'patch', changes: [{ package: 'argus', headline: 'sl flies the Enterprise.', body: '', internal: false }] },
      { package: 'brasa', version: '0.32.1', bump: 'patch', changes: [
        { package: 'brasa', headline: 'Bare help has a Games and utilities group.', body: 'General keeps help, date, exit and !.', internal: false },
        { package: 'brasa', headline: 'Internal: coverage.', body: '', internal: true },
      ] },
    ] },
    { date: null, merge: null, entries: [{ package: 'argus', version: '0.23.0', bump: 'minor', changes: [] }] },
  ],
};

describe('the NOTES pane', () => {
  it('titles a release by its day and the packages that moved', () => {
    expect(release_title(MODEL.releases[0]!)).toBe('2026-10-05 · argus 0.24.1 · brasa 0.32.1');
    expect(release_title(MODEL.releases[1]!)).toBe('undated · argus 0.23.0');
  });

  it('makes a row per headline, marks the ones with more, and unfolds the rest beneath', () => {
    const folded = notesBlocks_build(MODEL, new Set());
    expect(folded.map((b) => b.key)).toEqual(['f194de9c', 'undated']);
    expect(folded[0]!.rows.map((r) => `${r.tag}:${r.more}:${r.body}`)).toEqual(['argus:false:false', 'brasa:true:false', 'brasa:false:false']);
    expect(folded[0]!.rows[2]!.internal).toBe(true);
    const unfolded = notesBlocks_build(MODEL, new Set(['f194de9c:brasa:0']));
    expect(unfolded[0]!.rows.length).toBe(4);
    expect(unfolded[0]!.rows[2]).toMatchObject({ body: true, text: 'General keeps help, date, exit and !.', of: 'f194de9c:brasa:0', tag: '' });
  });

  it('reads the session.notes model off an outcome and ignores the rest', () => {
    const outcome = { envelopes: [{ status: 'ok', rendered: '', model: { kind: 'fs.cwd', data: {} } }, { status: 'ok', rendered: '', model: { kind: 'session.notes', data: MODEL } }] } as never;
    expect(notesModel_of(outcome)?.installed).toEqual({ argus: '0.24.1', brasa: '0.32.1' });
    expect(notesModel_of({ envelopes: [] } as never)).toBeNull();
    expect(notesModel_of({ envelopes: [{ status: 'ok', rendered: '', model: { kind: 'session.notes', data: { nonsense: true } } }] } as never)).toBeNull();
  });
});
