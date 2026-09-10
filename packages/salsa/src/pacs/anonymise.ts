/**
 * @file Standing in for what a PACS answer says about a person.
 *
 * A demo runs against a live hospital PACS, and a live PACS answers with
 * the names, record numbers and dates of real patients. This substitutes a
 * stable stand-in for each of those before an answer reaches a screen, so a
 * projector, a screenshot or a recording carries none of them.
 *
 * What this is NOT: anonymisation in the regulatory sense. A record number
 * is seven digits, an accession eight, and a hash of a space that small is
 * enumerable in under a second — so the salt below is what stands between a
 * token and the value behind it. The salt is made once per daemon and never
 * written down, which makes tokens stable through one demo and meaningless
 * after it. Two runs of the same demo do not agree, and that is the point:
 * a pairing leaked from one recording says nothing about any other.
 *
 * The DICOM identifiers are deliberately left alone. They are not shown in
 * a listing and they are what the kernel reconciles an answer against, so
 * standing in for them would break the answer while hiding nothing.
 *
 * @module
 */

import crypto from 'crypto';

/**
 * The secret behind every token, made once per process.
 *
 * A daemon is a session, so this is a session's salt: stable while the
 * demo runs, gone when it ends.
 */
const SALT: Buffer = crypto.randomBytes(32);

/** How many hex characters a stand-in identifier carries. */
const TOKEN_CHARS: number = 8;

/** Family names for the stand-in, chosen to read as names and nothing more. */
const SURNAMES: ReadonlyArray<string> = [
  'ASHDOWN', 'BELLWEATHER', 'CARRICK', 'DUNMORE', 'EASTWICK', 'FAIRHOLM',
  'GRANTLEY', 'HARBOURNE', 'IRVINGTON', 'JARRETT', 'KESTREL', 'LOWNDES',
  'MARCHETTI', 'NORWOOD', 'OAKLEY', 'PENHALE', 'QUILLON', 'RAVENSCAR',
  'STARLING', 'THORNBURY', 'UNDERHILL', 'VANTAGE', 'WESTMARCH', 'YARROW',
];

/** Given names for the stand-in. */
const FORENAMES: ReadonlyArray<string> = [
  'ALDEN', 'BRIONY', 'CASPAR', 'DELPHINE', 'EAMON', 'FENELLA', 'GARETH',
  'HESTER', 'ISOLDE', 'JASPER', 'KERENSA', 'LOWELL', 'MERIEL', 'NEVIN',
  'ORLA', 'PERRIN', 'QUENBY', 'ROSALIND', 'SEVERIN', 'TAMSIN', 'ULRIC',
  'VERITY', 'WYNTER', 'XANTHE',
];

/**
 * The stand-in for one value: stable for this session, opaque outside it.
 *
 * @param value - The real value.
 * @param chars - How many hex characters to keep.
 * @returns The stand-in, or an empty string for an empty value.
 */
export function token_of(value: string, chars: number = TOKEN_CHARS): string {
  if (value === '') return '';
  return crypto.createHash('sha256').update(SALT).update(value).digest('hex').slice(0, chars);
}

/**
 * A stand-in name, in the form DICOM writes one.
 *
 * The same person reads the same way everywhere in one answer, which is
 * what makes a demo followable; a different session gives a different
 * person the same name and nobody can tell.
 *
 * @param value - The real name.
 * @returns A name of the same shape, carrying nothing of the original.
 */
export function nameStandIn_of(value: string): string {
  if (value === '') return '';
  const digest: Buffer = crypto.createHash('sha256').update(SALT).update(value).digest();
  const surname: string = SURNAMES[digest[0] % SURNAMES.length] as string;
  const forename: string = FORENAMES[digest[1] % FORENAMES.length] as string;
  return `${surname}^${forename}`;
}

/**
 * A study date, coarsened to the month it fell in.
 *
 * @param value - A DICOM date, `YYYYMMDD`.
 * @returns The first of that month, or the value unchanged when it is not a date.
 */
export function date_toMonth(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 6)}01` : value;
}

/**
 * A birth date, coarsened to its year.
 *
 * Coarser than a study date on purpose: an age, with a modality and a small
 * institution, identifies a person where a month of imaging does not.
 *
 * @param value - A DICOM date, `YYYYMMDD`.
 * @returns The first of that year, or the value unchanged when it is not a date.
 */
export function birthDate_toYear(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}0101` : value;
}

/** How each identifying field is stood in for. */
const STAND_INS: Readonly<Record<string, (value: string) => string>> = {
  PatientID: (value: string): string => token_of(value),
  PatientName: nameStandIn_of,
  OtherPatientIDs: (value: string): string => token_of(value),
  OtherPatientNames: nameStandIn_of,
  PatientMotherBirthName: nameStandIn_of,
  AccessionNumber: (value: string): string => token_of(value),
  PatientBirthDate: birthDate_toYear,
  PatientBirthTime: (): string => '',
  PatientAge: (): string => '',
  PatientAddress: (): string => '',
  PatientTelephoneNumbers: (): string => '',
  StudyDate: date_toMonth,
  SeriesDate: date_toMonth,
  ReferringPhysicianName: nameStandIn_of,
  PerformingPhysicianName: nameStandIn_of,
  OperatorsName: nameStandIn_of,
  PhysiciansOfRecord: nameStandIn_of,
  NameOfPhysiciansReadingStudy: nameStandIn_of,
  InstitutionName: (value: string): string => (value === '' ? '' : `SITE ${token_of(value, 4)}`),
  InstitutionAddress: (): string => '',
};

/** The fields this stands in for, for a caller that needs to know. */
export const STOOD_IN_FIELDS: ReadonlyArray<string> = Object.keys(STAND_INS);

/**
 * Stands in for one field's value.
 *
 * @param field - The DICOM keyword.
 * @param value - What the PACS said.
 * @returns The stand-in, or the value unchanged when the field identifies nobody.
 */
export function field_standIn(field: string, value: string): string {
  const rule: ((value: string) => string) | undefined = STAND_INS[field];
  return rule === undefined ? value : rule(value);
}

/**
 * Walks a decoded PACS answer, standing in for every identifying value.
 *
 * Done on the DECODED payload rather than on the model or the rendering,
 * because both are built from it: substituting here means a listing, a
 * table, a CSV and a console line all say the same thing, and none of them
 * has to know this happened.
 *
 * @param payload - The decoded answer, as DICOM-shaped objects.
 * @returns A copy carrying stand-ins.
 */
export function answer_standIn(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((one: unknown): unknown => answer_standIn(one));
  if (payload === null || typeof payload !== 'object') return payload;

  const out: Record<string, unknown> = {};
  for (const [field, held] of Object.entries(payload as Record<string, unknown>)) {
    if (held !== null && typeof held === 'object' && 'value' in (held as Record<string, unknown>)) {
      const inner: Record<string, unknown> = held as Record<string, unknown>;
      const value: unknown = inner.value;
      out[field] = typeof value === 'string'
        ? { ...inner, value: field_standIn(field, value) }
        : { ...inner, value: answer_standIn(value) };
      continue;
    }
    if (typeof held === 'string') {
      out[field] = field_standIn(field, held);
      continue;
    }
    out[field] = answer_standIn(held);
  }
  return out;
}

/**
 * Stands in for the values in a query's own terms.
 *
 * The line an operator typed is the first thing on a screen and it carries
 * the record number they typed. This rewrites the terms so the echoed line
 * names the same token the rows do — which also ties the line to the answer
 * below it, rather than hiding it behind stars that a PACS would read as a
 * wildcard.
 *
 * @param criteria - The question, as field to value.
 * @returns The question with identifying values stood in for.
 */
export function criteria_standIn(criteria: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(criteria).map(([field, value]: [string, string]): [string, string] =>
      [field, field_standIn(field, value)]),
  );
}

/**
 * Stands in for identifying values inside a path.
 *
 * A query's VFS path spells the question, and CUBE's own PACS folders are
 * built from the record number, the name and the date of birth. Both are
 * shown beside an answer, so both are walked for anything that looks like
 * a value this module has already stood in for.
 *
 * @param path - The path as it reads.
 * @param values - The real values to stand in for, longest first.
 * @returns The path with those values replaced by their stand-ins.
 */
export function path_standIn(path: string, values: ReadonlyArray<{ field: string; value: string }>): string {
  let out: string = path;
  const byLength = [...values].sort((a, b): number => b.value.length - a.value.length);
  for (const { field, value } of byLength) {
    if (value === '') continue;
    out = out.split(value).join(field_standIn(field, value));
  }
  return out;
}
