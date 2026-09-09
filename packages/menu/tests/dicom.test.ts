/**
 * @file Schema tests for the DICOM vocabulary.
 *
 * The PHI flag and the nested sequence are the point: a surface redacts by
 * the flag, never by guessing at names, and a sequence's items have to
 * cross the wire as tags of their own.
 */

import { describe, it, expect } from '@jest/globals';
import {
  dicomTagSchema,
  dicomTagsModelSchema,
  dicomSeriesModelSchema,
  DICOM_MODEL_KINDS,
  DICOM_TAG_GROUPS,
  type DicomTag,
} from '../src/dicom.js';

function tag_make(extra: Partial<DicomTag> = {}): DicomTag {
  return { tag: '(0008,0060)', name: 'Modality', vr: 'CS', value: 'MR', group: 'series', phi: false, ...extra };
}

describe('dicomTagSchema', () => {
  it('accepts a tag with decoded words and nested sequence items', () => {
    const parsed = dicomTagSchema.safeParse(
      tag_make({
        tag: '(0008,1140)',
        name: 'ReferencedImageSequence',
        vr: 'SQ',
        value: '1 item',
        items: [[tag_make({ tag: '(0008,1150)', name: 'ReferencedSOPClassUID', vr: 'UI', value: '1.2' })]],
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items?.[0][0].name).toBe('ReferencedSOPClassUID');
  });

  it('degrades an unknown group to other rather than failing', () => {
    const parsed = dicomTagSchema.safeParse({ ...tag_make(), group: 'somewhere-new' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.group).toBe('other');
  });

  it('requires the phi flag', () => {
    const { phi: _phi, ...withoutPhi } = tag_make();
    expect(dicomTagSchema.safeParse(withoutPhi).success).toBe(false);
  });

  it('names every group a listing shows, in display order, patient first', () => {
    expect(DICOM_TAG_GROUPS).toEqual(['patient', 'study', 'series', 'image', 'equipment', 'meta', 'private', 'other']);
  });
});

describe('dicomTagsModelSchema', () => {
  it('carries a folder answer with what was read, what was refused, constant and varying', () => {
    const parsed = dicomTagsModelSchema.safeParse({
      path: '/s',
      subject: 'folder',
      read: 3,
      of: 16,
      refused: ['/s/0002.dcm'],
      constant: [tag_make()],
      varying: [
        {
          tag: '(0020,0013)',
          name: 'InstanceNumber',
          vr: 'IS',
          group: 'image',
          phi: false,
          distinct: 3,
          first: '1',
          last: '16',
          values: [
            { path: '/s/0001.dcm', value: '1' },
            { path: '/s/0002.dcm', value: null },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a subject it does not know', () => {
    expect(dicomTagsModelSchema.safeParse({ path: '/s', subject: 'study', read: 0, of: 0, refused: [], constant: [], varying: [] }).success).toBe(false);
  });
});

describe('dicomSeriesModelSchema', () => {
  it('accepts a full series answer', () => {
    const parsed = dicomSeriesModelSchema.safeParse({
      path: '/SERVICES/PACS/X/p/s/00005-T1-abcdef0',
      seriesInstanceUID: '1.2.3',
      studyInstanceUID: '1.2',
      modality: 'MR',
      seriesDescription: 'T1',
      seriesNumber: 5,
      instances: 16,
      frames: 1,
      order: 'filename',
      geometry: { rows: 256, columns: 256, pixelSpacing: [0.9, 0.9], sliceThickness: 1.5 },
      transferSyntax: { uid: '1.2.840.10008.1.2.1', name: 'Explicit VR Little Endian' },
      bytes: 2_000_000,
      header: '/SERVICES/PACS/X/p/s/00005-T1-abcdef0/0001-1.2.3.1.dcm',
      files: ['/SERVICES/PACS/X/p/s/00005-T1-abcdef0/0001-1.2.3.1.dcm'],
      annotations: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts the minimum a bare header can answer', () => {
    const parsed = dicomSeriesModelSchema.safeParse({
      path: '/f',
      modality: 'OT',
      seriesDescription: '',
      instances: 1,
      frames: 1,
      order: 'unknown',
      bytes: 10,
      header: '/f/a.dcm',
      files: ['/f/a.dcm'],
      annotations: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an order it does not know', () => {
    const parsed = dicomSeriesModelSchema.safeParse({
      path: '/f', modality: 'OT', seriesDescription: '', instances: 1, frames: 1, order: 'position', bytes: 1, header: '/f/a', files: [], annotations: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('DICOM_MODEL_KINDS', () => {
  it('namespaces both kinds under dicom', () => {
    expect(DICOM_MODEL_KINDS.tags).toBe('dicom.tags');
    expect(DICOM_MODEL_KINDS.series).toBe('dicom.series');
  });
});
