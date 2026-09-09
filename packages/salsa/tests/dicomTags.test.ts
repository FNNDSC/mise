/**
 * Tag reading against synthesized DICOM: names, groups, PHI flags, decoded
 * values, sequences, bulk data, and the constant-versus-varying split.
 */
import { describe, it, expect } from '@jest/globals';
import dcmjs from 'dcmjs';
import { dicomTags_read, dicomTags_summarize, dicomTag_find, type DicomTag, type DicomTagSet } from '../src/dicom/tags';
import { tagGroup_of, tagValue_decode, DICOM_TAG_GROUPS } from '../src/dicom/dictionary';
import { fixtureInstance_write, fixtureSeries_write, FIXTURE_SERIES_UID, FIXTURE_TRANSFER_SYNTAX } from './dicomFixture';

dcmjs.log.setLevel('silent');

function read_ok(bytes: Buffer): DicomTagSet {
  const result = dicomTags_read(bytes);
  if (!result.ok) throw new Error('fixture did not parse');
  return result.value;
}

describe('dicomTags_read', () => {
  const set: DicomTagSet = read_ok(fixtureInstance_write({ instanceNumber: 3 }));

  it('names tags from the dictionary with their VR and text value', () => {
    const modality: DicomTag | undefined = dicomTag_find(set.tags, 'Modality');
    expect(modality).toMatchObject({ tag: '(0008,0060)', vr: 'CS', value: 'MR', group: 'series' });
  });

  it('carries the transfer syntax from the meta group', () => {
    expect(set.transferSyntaxUID).toBe(FIXTURE_TRANSFER_SYNTAX);
    expect(dicomTag_find(set.tags, 'TransferSyntaxUID')).toMatchObject({ group: 'meta', decoded: 'Explicit VR Little Endian' });
  });

  it('flags identifying tags and never strips them', () => {
    expect(dicomTag_find(set.tags, 'PatientName')).toMatchObject({ phi: true, value: 'SYNTH^PATIENT', group: 'patient' });
    expect(dicomTag_find(set.tags, 'InstitutionName')).toMatchObject({ phi: true, group: 'equipment' });
    expect(dicomTag_find(set.tags, 'AccessionNumber')).toMatchObject({ phi: true });
    expect(dicomTag_find(set.tags, 'SeriesDescription')).toMatchObject({ phi: false });
  });

  it('decodes coded values in words', () => {
    expect(dicomTag_find(set.tags, 'Modality')?.decoded).toBe('Magnetic Resonance');
    expect(dicomTag_find(set.tags, 'PatientSex')?.decoded).toBe('Other');
    expect(dicomTag_find(set.tags, 'PatientPosition')?.decoded).toBe('Head First Supine');
    expect(dicomTag_find(set.tags, 'PhotometricInterpretation')?.decoded).toBe('Greyscale, minimum is black');
    expect(dicomTag_find(set.tags, 'SOPClassUID')?.decoded).toBe('MRImage');
    expect(dicomTag_find(set.tags, 'SeriesDescription')?.decoded).toBeUndefined();
  });

  it('joins multi-valued elements and places position tags in the image group', () => {
    expect(dicomTag_find(set.tags, 'ImagePositionPatient')).toMatchObject({ value: '0\\0\\3', group: 'image' });
    expect(dicomTag_find(set.tags, 'PixelSpacing')?.value).toBe('0.9375\\0.9375');
  });

  it('keeps sequence items as nested tags', () => {
    const sequence: DicomTag | undefined = dicomTag_find(set.tags, 'ReferencedImageSequence');
    expect(sequence?.vr).toBe('SQ');
    expect(sequence?.value).toBe('1 item');
    expect(sequence?.items?.[0].map((tag: DicomTag): string => tag.name)).toEqual(['ReferencedSOPClassUID', 'ReferencedSOPInstanceUID']);
  });

  it('says how many bytes bulk data holds instead of rendering it', () => {
    expect(dicomTag_find(set.tags, 'PixelData')?.value).toBe('<128 bytes>');
  });

  it('fails cleanly on bytes that are not DICOM', () => {
    expect(dicomTags_read(Buffer.from('not a dicom file at all')).ok).toBe(false);
  });

  it('names private tags as such', () => {
    const withPrivate: DicomTagSet = read_ok(fixtureInstance_write({ instanceNumber: 1, raw: { '00091001': { vr: 'LO', Value: ['vendor'] } } }));
    const found: DicomTag | undefined = withPrivate.tags.find((tag: DicomTag): boolean => tag.tag === '(0009,1001)');
    expect(found).toMatchObject({ name: 'PrivateTag', group: 'private', value: 'vendor' });
  });
});

describe('dictionary', () => {
  it('places tags by name before group number', () => {
    expect(tagGroup_of(0x0008, 'Modality')).toBe('series');
    expect(tagGroup_of(0x0008, 'StudyDate')).toBe('study');
    expect(tagGroup_of(0x0020, 'StudyInstanceUID')).toBe('study');
    expect(tagGroup_of(0x0028, undefined)).toBe('image');
    expect(tagGroup_of(0x0009, 'Anything')).toBe('private');
    expect(tagGroup_of(0x1234, undefined)).toBe('other');
  });

  it('lists groups in display order starting with the patient', () => {
    expect(DICOM_TAG_GROUPS[0]).toBe('patient');
    expect(DICOM_TAG_GROUPS).toContain('private');
  });

  it('decodes only what it knows', () => {
    expect(tagValue_decode('Modality', 'CT')).toBe('Computed Tomography');
    expect(tagValue_decode('Modality', 'ZZ')).toBeUndefined();
    expect(tagValue_decode('SeriesDescription', 'anything')).toBeUndefined();
  });
});

describe('dicomTags_summarize', () => {
  const files: Map<string, Buffer> = fixtureSeries_write('/series', 4);
  const read: Array<{ path: string; tags: DicomTagSet }> = [...files.entries()].map(([path, bytes]): { path: string; tags: DicomTagSet } => ({
    path,
    tags: read_ok(bytes),
  }));

  it('keeps what every file shares as constant', () => {
    const summary = dicomTags_summarize(read);
    const uid: DicomTag | undefined = summary.constant.find((tag: DicomTag): boolean => tag.name === 'SeriesInstanceUID');
    expect(uid?.value).toBe(FIXTURE_SERIES_UID);
    expect(summary.constant.some((tag: DicomTag): boolean => tag.name === 'InstanceNumber')).toBe(false);
  });

  it('reports what changes with its first, last and distinct count in folder order', () => {
    const summary = dicomTags_summarize(read);
    const position = summary.varying.find((tag): boolean => tag.name === 'ImagePositionPatient');
    expect(position).toMatchObject({ first: '0\\0\\0', last: '0\\0\\4.5', distinct: 4, group: 'image' });
    expect(position?.values.map((entry): string | null => entry.value)).toEqual(['0\\0\\0', '0\\0\\1.5', '0\\0\\3', '0\\0\\4.5']);
    const number = summary.varying.find((tag): boolean => tag.name === 'InstanceNumber');
    expect(number).toMatchObject({ first: '1', last: '4' });
  });

  it('treats a tag some files lack as varying with null for the missing ones', () => {
    const extra: DicomTagSet = read_ok(fixtureInstance_write({ instanceNumber: 5, extra: { ImageComments: 'only here' } }));
    const summary = dicomTags_summarize([...read, { path: '/series/0005.dcm', tags: extra }]);
    const comments = summary.varying.find((tag): boolean => tag.name === 'ImageComments');
    expect(comments).toMatchObject({ distinct: 1, first: 'only here', last: 'only here' });
    expect(comments?.values[0].value).toBeNull();
  });

  it('compares sequences by their items', () => {
    const summary = dicomTags_summarize(read);
    const sequence = summary.varying.find((tag): boolean => tag.name === 'ReferencedImageSequence');
    expect(sequence?.distinct).toBe(4);
    const same = dicomTags_summarize([read[0], read[0]]);
    expect(same.constant.some((tag: DicomTag): boolean => tag.name === 'ReferencedImageSequence')).toBe(true);
    expect(same.varying).toHaveLength(0);
  });
});
