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
import type { PacsQueryModel, PacsSeries, PacsStudy } from '@fnndsc/menu';
import { AnswerRow, answerAdapter_register } from './answer.js';

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
          value: path.posix.join(listing.path, item.name),
          label: item.name,
        });
      }
    }
    return rows;
  });

  // A PACS answer's rows are its SERIES, in study order then series order:
  // the series is what a pull, a gather and a viewer all take, and a study
  // that holds none contributes its own path so the study is still nameable.
  answerAdapter_register('pacs.query', (data: unknown): AnswerRow[] | null => {
    const model: PacsQueryModel | null = data as PacsQueryModel | null;
    if (model === null || !Array.isArray(model.studies)) return null;
    const rows: AnswerRow[] = [];
    for (const study of model.studies as PacsStudy[]) {
      const series: PacsSeries[] = Array.isArray(study.series) ? study.series : [];
      if (series.length === 0) {
        if (typeof study.vfsPath === 'string') {
          rows.push({ value: study.vfsPath, label: study.description || 'study' });
        }
        continue;
      }
      for (const one of series) {
        if (typeof one.vfsPath !== 'string') continue;
        rows.push({ value: one.vfsPath, label: one.description || one.modality || 'series' });
      }
    }
    return rows;
  });

  // The cohort's rows are its members, which is what makes `gather remove @2`
  // read the same way as every other numbered act.
  answerAdapter_register('gather.cohort', (data: unknown): AnswerRow[] | null => {
    const state = data as { series?: Array<{ vfsPath?: string; description?: string }> } | null;
    if (state === null || !Array.isArray(state.series)) return null;
    return state.series
      .filter((member): boolean => typeof member.vfsPath === 'string')
      .map((member): AnswerRow => ({
        value: member.vfsPath as string,
        label: member.description ?? path.posix.basename(member.vfsPath as string),
      }));
  });
}
