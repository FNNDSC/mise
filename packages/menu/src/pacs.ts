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
 * Where an answer came from: the PACS just now, or a query already stored.
 *
 * CUBE keeps every query it has run, so a question asked before can be
 * answered without troubling the PACS. Which of the two happened is a fact
 * about the answer, and it belongs on the model rather than in each
 * surface's rendering: chell says it in a sentence, argus in a pill, and
 * anything later in whatever voice it has — but all of them from one
 * timestamp, said once by the kernel that knows it.
 */
export const pacsProvenanceSchema = z.object({
  /** True when this answer came from a stored query rather than the PACS. */
  replayed: z.boolean(),
  /**
   * When the PACS actually answered, as an ISO timestamp.
   *
   * The age is stated and never acted on. A query naming an accession is a
   * fact about a study that exists; one naming an MRN can gain a match
   * tomorrow. No heuristic separates those reliably, so the surface says
   * how old an answer is and leaves the judgement with the operator.
   */
  answeredAt: z.string(),
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
  /**
   * Optional so an envelope from a daemon that predates replay still
   * parses: a surface reads its absence as "freshly queried, age unknown",
   * which is what such a daemon could only ever have meant.
   */
  provenance: pacsProvenanceSchema.optional(),
});

export type PacsProvenance = z.infer<typeof pacsProvenanceSchema>;
export type PacsSeries = z.infer<typeof pacsSeriesSchema>;
export type PacsStudy = z.infer<typeof pacsStudySchema>;
export type PacsQueryModel = z.infer<typeof pacsQueryModelSchema>;

/** The model's envelope kind. */
export const PACS_QUERY_MODEL_KIND = 'pacs.query' as const;
