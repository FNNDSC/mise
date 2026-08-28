/**
 * @file The PACS query vocabulary: search results as typed envelope payloads.
 *
 * A `pacs query` answers with studies containing series; the terminal renders
 * them as text while a graphical surface reads this model — the same
 * one-command-two-projections pattern as the DAG models. Series carry their
 * instance UIDs so a surface can lower a selection straight to
 * `pacs pull SeriesInstanceUID:<uid>`.
 *
 * @module
 */
import { z } from 'zod';

/** One series within a found study. */
export const pacsSeriesSchema = z.object({
  seriesUID: z.string(),
  description: z.string(),
  modality: z.string(),
  fileCount: z.number().optional(),
  /** The series' own VFS path under the query — the pull's argument. */
  vfsPath: z.string().optional(),
  /** True when CUBE already holds this series (a pull would just confirm). */
  pulled: z.boolean().optional(),
  /** How many files CUBE holds, when known. */
  pulledFiles: z.number().optional(),
});

/** One found study and its series. */
export const pacsStudySchema = z.object({
  studyUID: z.string().optional(),
  /** The study's VFS path under the query — a study-level pull's argument. */
  vfsPath: z.string().optional(),
  description: z.string(),
  patientName: z.string(),
  patientId: z.string(),
  date: z.string(),
  modalities: z.string(),
  accession: z.string(),
  series: z.array(pacsSeriesSchema),
});

/**
 * The `pacs.query` model: one query's decoded result. `vfsPath` is where the
 * query lives under `/net/pacs/queries` — a query is a persistent CUBE
 * object, re-checkable later.
 */
export const pacsQueryModelSchema = z.object({
  queryId: z.number(),
  vfsPath: z.string(),
  pacsName: z.string(),
  expression: z.string(),
  studies: z.array(pacsStudySchema),
});

export type PacsSeries = z.infer<typeof pacsSeriesSchema>;
export type PacsStudy = z.infer<typeof pacsStudySchema>;
export type PacsQueryModel = z.infer<typeof pacsQueryModelSchema>;

/** The model's envelope kind. */
export const PACS_QUERY_MODEL_KIND = 'pacs.query' as const;
