/**
 * @file query says when the PACS ignores a key it was given (#1105), from a
 * per-server list, and points at the grep that narrows instead.
 */
import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ignoredKeys_hint, ignoredKeys_read } from '../src/builtins/net/query.ignored.js';

describe('keys a PACS ignores', () => {
  it('names the ignored key and the grep that narrows, for the server that ignores it', () => {
    const lists = { PACSDCM: ['SeriesDescription', 'StudyDescription'] };
    expect(ignoredKeys_hint({ PatientID: ['1'], SeriesDescription: ['*T1*'] }, 'PACSDCM', lists))
      .toBe("[!] the PACS (PACSDCM) ignores SeriesDescription: the answer is not narrowed by it. Filter it with: query … | grep -i -e 'T1'");
    expect(ignoredKeys_hint({ seriesdescription: ['*T1*'], StudyDescription: ['Brain'] }, 'PACSDCM', lists))
      .toContain('ignores seriesdescription and StudyDescription: the answer is not narrowed by them');
    expect(ignoredKeys_hint({ SeriesDescription: ['*T1*'] }, 'OTHER', lists)).toBeNull();
    expect(ignoredKeys_hint({ Modality: ['MR'] }, 'PACSDCM', lists)).toBeNull();
  });

  it('reads the per-server lists from ~/.config/mise/pacs.json, else the built-in default', () => {
    const home: string = mkdtempSync(join(tmpdir(), 'pacs-ignored-'));
    expect(ignoredKeys_read({ XDG_CONFIG_HOME: home })).toEqual({ PACSDCM: ['SeriesDescription', 'StudyDescription'] });
    mkdirSync(join(home, 'mise'));
    writeFileSync(join(home, 'mise', 'pacs.json'), JSON.stringify({ ignoredKeys: { ORTHANC: ['StudyDescription', 3] } }));
    expect(ignoredKeys_read({ XDG_CONFIG_HOME: home })).toEqual({ ORTHANC: ['StudyDescription'] });
    rmSync(home, { recursive: true, force: true });
  });
});
