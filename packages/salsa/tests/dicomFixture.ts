/**
 * Synthesized DICOM for tests: an MR-shaped series written with dcmjs, named
 * the way oxidicom names files. No patient bytes anywhere; every value here
 * is invented.
 */
import dcmjs from 'dcmjs';
import type { DcmjsDict } from 'dcmjs';

const { DicomMetaDictionary, DicomDict } = dcmjs.data;

/** The invented series every fixture shares. */
export const FIXTURE_SERIES_UID: string = '1.2.826.0.1.3680043.8.498.1000';
export const FIXTURE_STUDY_UID: string = '1.2.826.0.1.3680043.8.498.100';
export const FIXTURE_TRANSFER_SYNTAX: string = '1.2.840.10008.1.2.1';

/** Knobs for one synthesized instance. */
export interface FixtureInstanceOptions {
  instanceNumber: number;
  rows?: number;
  columns?: number;
  /** Slice position along z, in mm. */
  z?: number;
  modality?: string;
  seriesDescription?: string;
  extra?: Record<string, unknown>;
  /** Raw elements merged into the dataset by `ggggeeee`, for private and unnamed tags. */
  raw?: DcmjsDict;
}

/**
 * Writes one DICOM instance.
 *
 * @param options - Instance knobs.
 * @returns The Part 10 bytes.
 */
export function fixtureInstance_write(options: FixtureInstanceOptions): Buffer {
  const rows: number = options.rows ?? 8;
  const columns: number = options.columns ?? 8;
  const sopInstanceUID: string = `${FIXTURE_SERIES_UID}.${options.instanceNumber}`;
  const dataset: Record<string, unknown> = {
    PatientName: 'SYNTH^PATIENT',
    PatientID: 'SYNTH0001',
    PatientBirthDate: '19700101',
    PatientSex: 'O',
    AccessionNumber: 'ACC0001',
    InstitutionName: 'Synthesized Institute',
    StudyInstanceUID: FIXTURE_STUDY_UID,
    StudyDescription: 'Synthesized study',
    SeriesInstanceUID: FIXTURE_SERIES_UID,
    SeriesDescription: options.seriesDescription ?? 'Synthesized T1',
    SeriesNumber: '5',
    Modality: options.modality ?? 'MR',
    Manufacturer: 'Synthesized',
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.4',
    SOPInstanceUID: sopInstanceUID,
    InstanceNumber: String(options.instanceNumber),
    ImagePositionPatient: [0, 0, options.z ?? (options.instanceNumber - 1) * 1.5],
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    PatientPosition: 'HFS',
    Rows: rows,
    Columns: columns,
    PixelSpacing: [0.9375, 0.9375],
    SliceThickness: 1.5,
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 0,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    ReferencedImageSequence: [{ ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.4', ReferencedSOPInstanceUID: sopInstanceUID }],
    ...(options.extra ?? {}),
  };
  for (const key of Object.keys(dataset)) if (dataset[key] === undefined) delete dataset[key];
  const meta: DcmjsDict = DicomMetaDictionary.denaturalizeDataset({
    TransferSyntaxUID: FIXTURE_TRANSFER_SYNTAX,
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.4',
    MediaStorageSOPInstanceUID: sopInstanceUID,
    ImplementationClassUID: '1.2.826.0.1.3680043.8.498.0',
  });
  const dict: DcmjsDict = {
    ...DicomMetaDictionary.denaturalizeDataset(dataset),
    '7FE00010': { vr: 'OW', Value: [new Uint16Array(rows * columns).buffer] },
    ...(options.raw ?? {}),
  };
  const file = new DicomDict(meta);
  file.dict = dict;
  return Buffer.from(file.write());
}

/**
 * The file name oxidicom gives an instance.
 *
 * @param instanceNumber - The instance number.
 * @returns `<InstanceNumber 4-padded>-<SOPInstanceUID>.dcm`.
 */
export function fixtureFile_name(instanceNumber: number): string {
  return `${String(instanceNumber).padStart(4, '0')}-${FIXTURE_SERIES_UID}.${instanceNumber}.dcm`;
}

/**
 * Writes a whole series into a map of path to bytes.
 *
 * @param folder - The folder the files sit in.
 * @param count - How many slices.
 * @returns Path to bytes, in instance order.
 */
export function fixtureSeries_write(folder: string, count: number): Map<string, Buffer> {
  const files: Map<string, Buffer> = new Map<string, Buffer>();
  for (let i = 1; i <= count; i++) {
    files.set(`${folder}/${fixtureFile_name(i)}`, fixtureInstance_write({ instanceNumber: i }));
  }
  return files;
}
