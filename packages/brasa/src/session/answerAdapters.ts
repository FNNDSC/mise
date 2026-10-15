/**
 * @file What each listing's rows are, for numbering.
 *
 * One adapter per model kind, registered once. A listing that has no adapter
 * simply has no numbers, which is the honest default: a model whose rows
 * nobody has said how to name cannot be acted on by index.
 *
 * @module
 */
import path from 'path';
import { patientAddress_of, type PacsQueryModel, type PacsSeries, type PacsStudy } from '@fnndsc/menu';
import { AnswerRow, answerAdapter_register, answerFilter_register } from './answer.js';

/** One target's listing, as `fs.listing` carries it. */
interface FsListing {
  path: string;
  items: Array<{ name: string; type?: string }>;
}

/**
 * Registers the adapters. Called once, when the engine is created.
 */
export function answerAdapters_register(): void {
  // A file listing's rows are paths, in the order the listing rendered them,
  // flattened across targets the way `ls a b` prints them.
  answerAdapter_register('fs.listing', (data: unknown): AnswerRow[] | null => {
    if (!Array.isArray(data)) return null;
    const rows: AnswerRow[] = [];
    for (const listing of data as FsListing[]) {
      if (listing === null || typeof listing !== 'object' || !Array.isArray(listing.items)) continue;
      for (const item of listing.items) {
        rows.push({
          kind: item.type === 'dir' ? 'DIR' : 'FIL',
          values: [path.posix.join(listing.path, item.name)],
          label: item.name,
          text: item.name,
        });
      }
    }
    return rows;
  });

  // A PACS answer numbers its PATIENTS, its STUDIES and its SERIES, each in
  // its own sequence. A patient hands over every series of every study of
  // theirs, a study hands over its series — what the surface's GATHER on
  // each hands over — so `pull @PAT001` and `gather add @STD001` act on the
  // whole of it, while `@SER003` names one series. A patient the PACS
  // answered nothing for has nothing to hand and wears no number.
  answerAdapter_register('pacs.query', (data: unknown): AnswerRow[] | null => {
    const model: PacsQueryModel | null = data as PacsQueryModel | null;
    if (model === null || !Array.isArray(model.studies)) return null;
    const rows: AnswerRow[] = [];
    // An answer that names its patients is taken at its word; one that does
    // not (a single question, an older daemon) has a patient for every
    // study's patient, in the studies' order — the same rows the surface
    // derives, so the numbers land on them.
    const patients: Array<{ patientId: string; server?: string; patientName?: string }> =
      Array.isArray(model.patients) && model.patients.length > 0
        ? model.patients
        : (model.studies as PacsStudy[]).reduce((seen: Array<{ patientId: string; server?: string; patientName?: string }>, study: PacsStudy) => {
          if (!seen.some((one): boolean => one.patientId === study.patientId)) {
            seen.push({ patientId: study.patientId, ...(study.patientName !== undefined ? { patientName: study.patientName } : {}) });
          }
          return seen;
        }, []);
    for (const patient of patients) {
      const theirs: PacsStudy[] = (model.studies as PacsStudy[]).filter((study: PacsStudy): boolean =>
        study.patientId === patient.patientId && (patient.server === undefined || study.server === undefined || study.server === patient.server));
      const seriesPaths: string[] = theirs
        .flatMap((study: PacsStudy): PacsSeries[] => (Array.isArray(study.series) ? study.series : []))
        .map((one: PacsSeries): string | undefined => one.vfsPath)
        .filter((one: string | undefined): one is string => typeof one === 'string');
      if (seriesPaths.length === 0) continue;
      rows.push({ kind: 'PAT', address: patientAddress_of(patient), values: seriesPaths, label: patient.patientName || patient.patientId, text: `${patient.patientName ?? ''} (ID: ${patient.patientId})` });
    }
    // A study's patient, by the same match the patients were found with: the
    // parent a filter keeps a study with.
    const patientOf = (study: PacsStudy): string | undefined => {
      const owner = patients.find((patient): boolean =>
        patient.patientId === study.patientId && (patient.server === undefined || study.server === undefined || study.server === patient.server));
      return owner === undefined ? undefined : `PAT:${patientAddress_of(owner)}`;
    };
    for (const study of model.studies as PacsStudy[]) {
      const series: PacsSeries[] = Array.isArray(study.series) ? study.series : [];
      const seriesPaths: string[] = series
        .map((one: PacsSeries): string | undefined => one.vfsPath)
        .filter((one: string | undefined): one is string => typeof one === 'string');
      if (typeof study.vfsPath === 'string') {
        const parent: string | undefined = patientOf(study);
        rows.push({
          kind: 'STD',
          // The study's own path leads, as the address a surface matches on;
          // its series follow, as what a verb is handed.
          values: [study.vfsPath, ...seriesPaths],
          label: study.description || 'study',
          text: [study.description, study.date, study.modalities].filter((one: string): boolean => one !== '').join('   '),
          ...(parent !== undefined ? { parent } : {}),
        });
      }
      for (const one of series) {
        if (typeof one.vfsPath !== 'string') continue;
        rows.push({
          kind: 'SER',
          values: [one.vfsPath],
          label: one.description || one.modality || 'series',
          text: `${one.description || '(no description)'}${one.modality ? ` [${one.modality}]` : ''}${one.fileCount === undefined ? '' : ` ${one.fileCount} files`}`,
          ...(typeof study.vfsPath === 'string' ? { parent: `STD:${study.vfsPath}` } : {}),
        });
      }
    }
    return rows;
  });

  // The cohort's rows are its members, which is what makes `gather remove @2`
  // read the same way as every other numbered act.
  answerAdapter_register('gather.cohort', (data: unknown): AnswerRow[] | null => {
    const state = data as { series?: Array<{ vfsPath?: string; description?: string; kind?: string }> } | null;
    if (state === null || !Array.isArray(state.series)) return null;
    return state.series
      .filter((member): boolean => typeof member.vfsPath === 'string')
      .map((member): AnswerRow => ({
        kind: member.kind === 'dir' ? 'DIR' : member.kind === 'file' ? 'FIL' : 'SER',
        values: [member.vfsPath as string],
        label: member.description ?? path.posix.basename(member.vfsPath as string),
        text: `${member.description ?? path.posix.basename(member.vfsPath as string)} ${member.vfsPath as string}`,
      }));
  });

  // Each listing filtered to the rows a filter kept (`KIND:address`), as the
  // same kind of model, so it renders, numbers and travels as before (#1100).
  answerFilter_register('fs.listing', (data: unknown, keep: ReadonlySet<string>): unknown =>
    (Array.isArray(data) ? (data as FsListing[]) : []).map((listing: FsListing) => ({
      ...listing,
      items: listing.items.filter((item) => keep.has(`${item.type === 'dir' ? 'DIR' : 'FIL'}:${path.posix.join(listing.path, item.name)}`)),
    })));
  answerFilter_register('pacs.query', (data: unknown, keep: ReadonlySet<string>): unknown => {
    const model: PacsQueryModel = data as PacsQueryModel;
    const studies: PacsStudy[] = (model.studies as PacsStudy[])
      .filter((study: PacsStudy): boolean => typeof study.vfsPath === 'string' && keep.has(`STD:${study.vfsPath}`))
      .map((study: PacsStudy): PacsStudy => ({ ...study, series: study.series.filter((one: PacsSeries): boolean => typeof one.vfsPath === 'string' && keep.has(`SER:${one.vfsPath}`)) }));
    const patients = Array.isArray(model.patients) ? model.patients.filter((patient): boolean => keep.has(`PAT:${patientAddress_of(patient)}`)) : undefined;
    return { ...model, studies, ...(patients !== undefined ? { patients } : {}) };
  });
  answerFilter_register('gather.cohort', (data: unknown, keep: ReadonlySet<string>): unknown => {
    const state = data as { series?: Array<{ vfsPath?: string; kind?: string }> } & Record<string, unknown>;
    const kindCode = (member: { kind?: string }): string => (member.kind === 'dir' ? 'DIR' : member.kind === 'file' ? 'FIL' : 'SER');
    return { ...state, series: (state.series ?? []).filter((member): boolean => keep.has(`${kindCode(member)}:${member.vfsPath ?? ''}`)) };
  });
}
