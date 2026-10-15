/**
 * @file A PACS answer as the terminal reads it: patients, their studies and
 * their series, each wearing the handle that names it (#1099).
 *
 * Rendered from the model the numbers come from, so what is printed is what
 * an index expands to: `@SER3` on screen is `@SER3` to `gather add`. The
 * footer says what is now numbered, which is also the cue for what an index
 * means after the next listing replaces this one.
 *
 * @module
 */
import chalk from 'chalk';
import { patientAddress_of, type PacsPatient, type PacsQueryModel, type PacsSeries, type PacsStudy } from '@fnndsc/menu';
import { answerNumbering_of, handleWords_of, numberedFooter_of, type NumberedHandle } from '../../session/answer.js';

/** The model kind a PACS answer travels as. */
const PACS_KIND: string = 'pacs.query';

/** A patient as the view groups by: the model's own, or one derived from a study. */
type ViewPatient = Pick<PacsPatient, 'patientId'> & { patientName?: string; server?: string };

/**
 * The patients of an answer, in the order the numbering walks them: the
 * model's own when it names them, else one per study's patient, as the
 * numbering derives them (session/answerAdapters.ts).
 *
 * @param model - The answer.
 * @returns The patients.
 */
function patients_of(model: PacsQueryModel): ViewPatient[] {
  if (Array.isArray(model.patients) && model.patients.length > 0) return model.patients;
  const seen: ViewPatient[] = [];
  for (const study of model.studies) {
    if (!seen.some((one: ViewPatient): boolean => one.patientId === study.patientId)) {
      seen.push({ patientId: study.patientId, ...(study.patientName !== '' ? { patientName: study.patientName } : {}) });
    }
  }
  return seen;
}

/**
 * Renders a PACS answer with its handles.
 *
 * @param model - The answer.
 * @returns The lines, or null when there are no studies.
 */
export function pacsAnswer_render(model: PacsQueryModel): string | null {
  if (model.studies.length === 0) return null;
  const handles: NumberedHandle[] = answerNumbering_of(PACS_KIND, model) ?? [];
  const words: Map<string, string> = handleWords_of(handles);
  // Handles align by kind: the widest of each sets its column.
  const widest = (kind: string): number => Math.max(0, ...handles.filter((one: NumberedHandle): boolean => one.kind === kind).map((one: NumberedHandle): number => `@${one.kind}${one.ordinal}`.length));
  const pad = (word: string | undefined, kind: string): string => chalk.cyan((word ?? '').padEnd(widest(kind)));
  const seriesCount: number = model.studies.reduce((sum: number, study: PacsStudy): number => sum + study.series.length, 0);
  const lines: string[] = ['', chalk.gray(`  ${model.studies.length} ${model.studies.length === 1 ? 'study' : 'studies'}, ${seriesCount} series`), ''];
  for (const patient of patients_of(model)) {
    const theirs: PacsStudy[] = model.studies.filter((study: PacsStudy): boolean =>
      study.patientId === patient.patientId && (patient.server === undefined || study.server === undefined || study.server === patient.server));
    if (theirs.length === 0) continue;
    const name: string = patient.patientName ?? theirs[0]?.patientName ?? '';
    lines.push(`  ${pad(words.get(`PAT:${patientAddress_of(patient)}`), 'PAT')}  ${chalk.bold(name || '(no name)')}${patient.patientId ? chalk.gray(` (ID: ${patient.patientId})`) : ''}`);
    for (const study of theirs) {
      const facts: string = [study.date, study.modalities, study.accession ? `acc ${study.accession}` : ''].filter((one: string): boolean => one !== '').join('   ');
      lines.push(`    ${pad(study.vfsPath === undefined ? undefined : words.get(`STD:${study.vfsPath}`), 'STD')}  ${chalk.bold.cyan(study.description || '(no description)')}${facts ? chalk.gray(`   ${facts}`) : ''}`);
      for (const series of study.series as PacsSeries[]) {
        const files: string = series.fileCount === undefined ? '' : chalk.gray(` ${series.fileCount} files`);
        const modality: string = series.modality ? chalk.yellow(` [${series.modality}]`) : '';
        lines.push(`      ${pad(series.vfsPath === undefined ? undefined : words.get(`SER:${series.vfsPath}`), 'SER')}  ${series.description || '(no description)'}${modality}${files}`);
      }
    }
    lines.push('');
  }
  const footer: string = numberedFooter_of(handles);
  if (footer !== '') lines.push(chalk.gray(`  ${footer}`));
  return lines.join('\n');
}
