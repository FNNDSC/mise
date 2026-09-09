/**
 * @file The static knowledge a tag listing needs beyond the DICOM dictionary:
 * which module a tag belongs to, which tags carry identifying information,
 * and how a handful of coded values read in words.
 *
 * All three are surfaces' concerns as much as the kernel's, so they live
 * once, here, and every surface renders from the same answer: grouping
 * decides where a row sits, the PHI flag decides whether it is shown or
 * redacted, decoding gives a human the meaning of `MR` or `HFS`. The kernel
 * flags and decodes; it never strips.
 *
 * @module
 */

/** Where a tag sits in a grouped listing. */
export type DicomTagGroup =
  | 'meta'
  | 'patient'
  | 'study'
  | 'series'
  | 'image'
  | 'equipment'
  | 'private'
  | 'other';

/** The groups in the order a listing shows them. */
export const DICOM_TAG_GROUPS: readonly DicomTagGroup[] = [
  'patient',
  'study',
  'series',
  'image',
  'equipment',
  'meta',
  'private',
  'other',
];

/**
 * Named tags whose module the group number alone gets wrong. Group 0008 mixes
 * study, series and image identity; 0018 mixes acquisition and equipment;
 * 0020 mixes study, series and image position.
 */
const GROUP_BY_NAME: Readonly<Record<string, DicomTagGroup>> = {
  // 0008: series identity and content
  Modality: 'series',
  SeriesDate: 'series',
  SeriesTime: 'series',
  SeriesDescription: 'series',
  BodyPartExamined: 'series',
  ProtocolName: 'series',
  // 0008: image identity
  SOPClassUID: 'image',
  SOPInstanceUID: 'image',
  ImageType: 'image',
  ContentDate: 'image',
  ContentTime: 'image',
  AcquisitionDate: 'image',
  AcquisitionTime: 'image',
  AcquisitionNumber: 'image',
  // 0008: equipment
  Manufacturer: 'equipment',
  ManufacturerModelName: 'equipment',
  StationName: 'equipment',
  InstitutionName: 'equipment',
  InstitutionAddress: 'equipment',
  InstitutionalDepartmentName: 'equipment',
  // 0018: equipment
  DeviceSerialNumber: 'equipment',
  SoftwareVersions: 'equipment',
  MagneticFieldStrength: 'equipment',
  // 0020: study
  StudyInstanceUID: 'study',
  StudyID: 'study',
  // 0020: series
  SeriesInstanceUID: 'series',
  SeriesNumber: 'series',
  FrameOfReferenceUID: 'series',
  PositionReferenceIndicator: 'series',
  PatientPosition: 'series',
  // 0020: image
  InstanceNumber: 'image',
  ImagePositionPatient: 'image',
  ImageOrientationPatient: 'image',
  SliceLocation: 'image',
  ImageComments: 'image',
  NumberOfFrames: 'image',
};

/** Module by tag group number, for tags the name table does not place. */
const GROUP_BY_NUMBER: Readonly<Record<number, DicomTagGroup>> = {
  0x0002: 'meta',
  0x0008: 'study',
  0x0010: 'patient',
  0x0018: 'series',
  0x0020: 'image',
  0x0028: 'image',
  0x0032: 'study',
  0x0038: 'patient',
  0x0040: 'study',
  0x0054: 'series',
  0x0070: 'image',
  0x0088: 'series',
  0x3006: 'image',
  0x7fe0: 'image',
};

/**
 * Places a tag in its listing group.
 *
 * @param groupNumber - The tag's group number (the `gggg` of `(gggg,eeee)`).
 * @param name - The dictionary name, when the tag has one.
 * @returns The listing group.
 */
export function tagGroup_of(groupNumber: number, name: string | undefined): DicomTagGroup {
  if (groupNumber % 2 === 1) return 'private';
  if (name !== undefined && GROUP_BY_NAME[name] !== undefined) return GROUP_BY_NAME[name];
  return GROUP_BY_NUMBER[groupNumber] ?? 'other';
}

/**
 * Tags that identify a person or an institution. Flagged on the model so a
 * surface can redact; never stripped by the kernel.
 */
export const DICOM_PHI_TAGS: ReadonlySet<string> = new Set<string>([
  'PatientName',
  'PatientID',
  'PatientBirthDate',
  'PatientBirthTime',
  'PatientAddress',
  'PatientTelephoneNumbers',
  'OtherPatientIDs',
  'OtherPatientNames',
  'PatientMotherBirthName',
  'InstitutionName',
  'InstitutionAddress',
  'ReferringPhysicianName',
  'PerformingPhysicianName',
  'OperatorsName',
  'PhysiciansOfRecord',
  'NameOfPhysiciansReadingStudy',
  'AccessionNumber',
]);

/** Words for the coded values a reader meets first. */
const MODALITY_NAMES: Readonly<Record<string, string>> = {
  MR: 'Magnetic Resonance',
  CT: 'Computed Tomography',
  PT: 'Positron Emission Tomography',
  NM: 'Nuclear Medicine',
  US: 'Ultrasound',
  CR: 'Computed Radiography',
  DX: 'Digital Radiography',
  MG: 'Mammography',
  RF: 'Radio Fluoroscopy',
  XA: 'X-Ray Angiography',
  OT: 'Other',
  SR: 'Structured Report',
  SEG: 'Segmentation',
  RTSTRUCT: 'RT Structure Set',
  RTDOSE: 'RT Dose',
  RTPLAN: 'RT Plan',
  PR: 'Presentation State',
  KO: 'Key Object Selection',
  DOC: 'Document',
};

const PATIENT_SEX_NAMES: Readonly<Record<string, string>> = {
  M: 'Male',
  F: 'Female',
  O: 'Other',
};

const PATIENT_POSITION_NAMES: Readonly<Record<string, string>> = {
  HFS: 'Head First Supine',
  HFP: 'Head First Prone',
  HFDR: 'Head First Decubitus Right',
  HFDL: 'Head First Decubitus Left',
  FFS: 'Feet First Supine',
  FFP: 'Feet First Prone',
  FFDR: 'Feet First Decubitus Right',
  FFDL: 'Feet First Decubitus Left',
};

const PHOTOMETRIC_NAMES: Readonly<Record<string, string>> = {
  MONOCHROME1: 'Greyscale, minimum is white',
  MONOCHROME2: 'Greyscale, minimum is black',
  RGB: 'Colour, RGB',
  'PALETTE COLOR': 'Colour, palette',
  YBR_FULL: 'Colour, YBR full',
  YBR_FULL_422: 'Colour, YBR 4:2:2',
  YBR_RCT: 'Colour, YBR reversible',
  YBR_ICT: 'Colour, YBR irreversible',
};

/** Transfer syntaxes by UID. A renderer's decoder support is judged against these. */
export const TRANSFER_SYNTAX_NAMES: Readonly<Record<string, string>> = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline (8-bit)',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended (12-bit)',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless SV1',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.201': 'High-Throughput JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.202': 'High-Throughput JPEG 2000 Lossless RPCL',
  '1.2.840.10008.1.2.4.203': 'High-Throughput JPEG 2000',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
};

/** Decoders by tag name; each answers with words or nothing. */
const DECODERS: Readonly<Record<string, (value: string) => string | undefined>> = {
  Modality: (value: string): string | undefined => MODALITY_NAMES[value],
  PatientSex: (value: string): string | undefined => PATIENT_SEX_NAMES[value],
  PatientPosition: (value: string): string | undefined => PATIENT_POSITION_NAMES[value],
  PhotometricInterpretation: (value: string): string | undefined => PHOTOMETRIC_NAMES[value],
  TransferSyntaxUID: (value: string): string | undefined => TRANSFER_SYNTAX_NAMES[value],
};

/**
 * Reads a coded value in words, for the short list of tags a reader meets
 * first. SOP class UIDs are named by the caller through the dictionary.
 *
 * @param name - The tag's dictionary name.
 * @param value - The tag's formatted value.
 * @returns The decoded words, or undefined when the tag is not coded or the
 *   code is unknown.
 */
export function tagValue_decode(name: string, value: string): string | undefined {
  const decoder: ((value: string) => string | undefined) | undefined = DECODERS[name];
  return decoder === undefined ? undefined : decoder(value);
}
