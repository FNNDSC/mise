/**
 * @file What a gathered member is, told by the kernel rather than a surface.
 *
 * A member is stored by its path; what a listing shows about it — a series'
 * description, modality, patient and study, whether a folder is imagery —
 * is filled in here when it is gathered, so every surface reads the same
 * row and none of them has to carry facts into the cohort itself.
 *
 * A series' facts come from the query answer its path names. The PACS
 * mount already holds that answer decoded (the operator listed it to find
 * the series), so this is usually a cache read and at most one CUBE read
 * per query. A folder's imagery comes from its name and place alone.
 *
 * @module
 */
import path from 'path';
import { queryId_extractFromFolder } from '@fnndsc/salsa';
import { seriesFolder_is, type PacsSeries, type PacsStudy } from '@fnndsc/menu';
import type { PACSQueryDecodedResult } from '@fnndsc/cumin';
import type { GatherMember } from './gather.store.js';

/** One series as its query answer holds it, with the study it is in. */
interface AnsweredSeries {
  series: PacsSeries;
  study: PacsStudy;
}

/**
 * The query a PACS path lives under: its id and its folder's path.
 *
 * @param address - A resolved `/net/pacs/queries/...` path.
 * @returns The query, or null when the path names none.
 */
function pathQuery_parse(address: string): { queryId: number; folder: string } | null {
  if (!address.startsWith('/net/pacs/')) return null;
  const parts: string[] = address.split('/').filter(Boolean);
  const at: number = parts.findIndex((part: string): boolean => /_qid:\d+/.test(part));
  if (at === -1) return null;
  const queryId: number = queryId_extractFromFolder(parts[at] as string);
  if (Number.isNaN(queryId)) return null;
  return { queryId, folder: `/${parts.slice(0, at + 1).join('/')}` };
}

/**
 * Every series one query answered, by series UID.
 *
 * @param queryId - The query.
 * @param folder - Its folder, which the answer's paths are built under.
 * @returns The series, or an empty map when the answer cannot be read.
 */
async function answerSeries_get(queryId: number, folder: string): Promise<Map<string, AnsweredSeries>> {
  const byUID: Map<string, AnsweredSeries> = new Map();
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const decoded: PACSQueryDecodedResult | null = await vfsDispatcher.pacs.queryResult_fetch(queryId);
  if (decoded === null || decoded.json === undefined || decoded.json === null) return byUID;
  // Loaded on demand: only a series gathered from an answer needs it.
  const { pacsQueryModel_build } = await import('../net/query.model.js');
  const model = pacsQueryModel_build(decoded, { queryId, vfsPath: folder, pacsName: '', expression: '' });
  for (const study of model.studies) {
    for (const series of study.series) byUID.set(series.seriesUID, { series, study });
  }
  return byUID;
}

/**
 * Fills in each series member's facts from the query answer its path names.
 *
 * A fact the answer does not have is left as it was, and an answer that
 * cannot be read leaves the member bare: these are what a listing shows,
 * and none of them is a reason to refuse the gather.
 *
 * @param members - Members being gathered, changed in place.
 */
export async function seriesFacts_fill(members: GatherMember[]): Promise<void> {
  const queries: Map<number, string> = new Map();
  for (const member of members) {
    if (member.kind !== 'series' || member.seriesUID === undefined) continue;
    const query: { queryId: number; folder: string } | null = pathQuery_parse(member.vfsPath);
    if (query !== null) queries.set(query.queryId, query.folder);
  }
  const answered: Map<number, Map<string, AnsweredSeries>> = new Map();
  for (const [queryId, folder] of queries) answered.set(queryId, await answerSeries_get(queryId, folder));

  for (const member of members) {
    if (member.kind !== 'series' || member.seriesUID === undefined) continue;
    const query: { queryId: number; folder: string } | null = pathQuery_parse(member.vfsPath);
    if (query === null) continue;
    const found: AnsweredSeries | undefined = answered.get(query.queryId)?.get(member.seriesUID);
    if (found === undefined) continue;
    const { series, study } = found;
    if (series.description !== '') member.description = series.description;
    if (series.modality !== '') member.modality = series.modality;
    if (series.fileCount !== undefined) member.files = series.fileCount;
    // MRN first, as the PACS listing reads a patient; the name when the
    // answer carries no identifier.
    const patient: string = study.patientId || study.patientName;
    if (patient !== '') member.patient = patient;
    if (study.description !== '') member.study = study.description;
  }
}

/**
 * Whether a gathered folder is imagery, by its name and place.
 *
 * @param member - A member being gathered.
 * @returns True for a directory that holds one series.
 */
export function placeImagery_is(member: GatherMember): boolean {
  return member.kind === 'dir' && seriesFolder_is(member.vfsPath, path.posix.basename(member.vfsPath));
}
