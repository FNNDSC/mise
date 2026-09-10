/**
 * @file Synthesized image fixtures for the smoke suite: a 16-slice MR-shaped
 * DICOM series named the way oxidicom names files, and a tiny gzip NIfTI-1
 * sphere. Written at test time; no patient bytes anywhere, every value here
 * is invented.
 *
 * The series carries a ReferencedImageSequence so a tags scenario can prove
 * that a filter descends into sequence items. dcmjs comes from the
 * workspace (salsa depends on it).
 *
 *   node tests/smoke/fixtures/synth.mjs <dir>   writes both under <dir>
 *
 * @module
 */
import dcmjs from 'dcmjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

dcmjs.log.setLevel('silent');
const { DicomMetaDictionary, DicomDict } = dcmjs.data;

export const SERIES_UID = '1.2.826.0.1.3680043.8.498.1000';
export const STUDY_UID = '1.2.826.0.1.3680043.8.498.100';
/** The folder oxidicom would give this series: `<SeriesNumber>-<description>-<7 hex of the UID hash>`. */
export const SERIES_FOLDER = '00005-Synthesized_T1-abcdef0';
export const SLICES = 16;

/**
 * Writes the series into `<dir>/<SERIES_FOLDER>/`.
 *
 * @param {string} dir - Where the series folder goes.
 * @returns {string[]} The file paths written, in instance order.
 */
export function series_write(dir) {
  const folder = join(dir, SERIES_FOLDER);
  mkdirSync(folder, { recursive: true });
  const written = [];
  for (let n = 1; n <= SLICES; n++) {
    const sop = `${SERIES_UID}.${n}`;
    const rows = 64;
    const columns = 64;
    const dataset = {
      PatientName: 'SYNTH^PATIENT', PatientID: 'SYNTH0001', PatientBirthDate: '19700101', PatientSex: 'O',
      AccessionNumber: 'ACC0001', InstitutionName: 'Synthesized Institute',
      StudyInstanceUID: STUDY_UID, StudyDescription: 'Synthesized study', StudyDate: '20260909',
      SeriesInstanceUID: SERIES_UID, SeriesDescription: 'Synthesized T1', SeriesNumber: '5', Modality: 'MR',
      Manufacturer: 'Synthesized', SOPClassUID: '1.2.840.10008.5.1.4.1.1.4', SOPInstanceUID: sop,
      InstanceNumber: String(n), ImagePositionPatient: [0, 0, (n - 1) * 1.5], ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
      PatientPosition: 'HFS', Rows: rows, Columns: columns, PixelSpacing: [0.9375, 0.9375], SliceThickness: 1.5,
      BitsAllocated: 16, BitsStored: 16, HighBit: 15, PixelRepresentation: 0, SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      ReferencedImageSequence: [{ ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.4', ReferencedSOPInstanceUID: `${SERIES_UID}.${n === 1 ? 1 : n - 1}` }],
    };
    const meta = DicomMetaDictionary.denaturalizeDataset({
      TransferSyntaxUID: '1.2.840.10008.1.2.1', MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.4',
      MediaStorageSOPInstanceUID: sop, ImplementationClassUID: '1.2.826.0.1.3680043.8.498.0',
    });
    const pixels = new Uint16Array(rows * columns);
    for (let i = 0; i < pixels.length; i++) pixels[i] = ((i % columns) * 4 + n * 50) & 0xffff;
    const dict = { ...DicomMetaDictionary.denaturalizeDataset(dataset), '7FE00010': { vr: 'OW', Value: [pixels.buffer] } };
    const file = new DicomDict(meta);
    file.dict = dict;
    const path = join(folder, `${String(n).padStart(4, '0')}-${sop}.dcm`);
    writeFileSync(path, Buffer.from(file.write()));
    written.push(path);
  }
  return written;
}

/**
 * Writes a 16x16x16 int16 gzip NIfTI-1 with a bright sphere in it.
 *
 * @param {string} path - The `.nii.gz` to write.
 * @returns {string} The path.
 */
export function nifti_write(path) {
  const [nx, ny, nz] = [16, 16, 16];
  const header = Buffer.alloc(352);
  header.writeInt32LE(348, 0);
  header.writeInt16LE(3, 40); header.writeInt16LE(nx, 42); header.writeInt16LE(ny, 44); header.writeInt16LE(nz, 46);
  header.writeInt16LE(1, 48); header.writeInt16LE(1, 50); header.writeInt16LE(1, 52); header.writeInt16LE(1, 54);
  header.writeInt16LE(4, 70);
  header.writeInt16LE(16, 72);
  header.writeFloatLE(1, 76); header.writeFloatLE(1, 80); header.writeFloatLE(1, 84); header.writeFloatLE(1, 88);
  header.writeFloatLE(352, 108);
  header.writeFloatLE(1, 112);
  header.writeInt8(10, 123);
  header.writeInt16LE(1, 252);
  header.writeInt16LE(1, 254);
  header.writeFloatLE(1, 280); header.writeFloatLE(1, 300); header.writeFloatLE(1, 320);
  header.write('n+1\0', 344, 'ascii');
  const data = Buffer.alloc(nx * ny * nz * 2);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5, z - 7.5);
    data.writeInt16LE(d < 5 ? 1000 - Math.round(d * 100) : 50, 2 * (x + nx * (y + ny * z)));
  }
  writeFileSync(path, gzipSync(Buffer.concat([header, data])));
  return path;
}

if (process.argv[1] && process.argv[1].endsWith('synth.mjs') && process.argv[2]) {
  const dir = process.argv[2];
  mkdirSync(dir, { recursive: true });
  const files = series_write(dir);
  const nifti = nifti_write(join(dir, 'sphere.nii.gz'));
  console.log(`${files.length} slices in ${join(dir, SERIES_FOLDER)}\n${nifti}`);
}
