/**
 * @file The DICOM vocabulary: tags and series as typed envelope payloads.
 *
 * `dcm tags` answers with every element of a file, or with what a folder's
 * files share against what changes across them; `dcm series` answers with
 * what a folder is as a series. A terminal renders both as text; a
 * graphical surface reads these models — a tags listing that follows a
 * scroll, an image pane that knows its modality before its first pixel.
 * The kernel flags identifying tags and never strips them: redaction is
 * the surface's choice, and the flag is how it chooses.
 *
 * @module
 */
import { z } from 'zod';

/** Where a tag sits in a grouped listing, in the order a listing shows the groups. */
export const DICOM_TAG_GROUPS = ['patient', 'study', 'series', 'image', 'equipment', 'meta', 'private', 'other'] as const;

export const dicomTagGroupSchema = z.enum(DICOM_TAG_GROUPS).catch('other');

/** One element of a DICOM dataset. Sequences carry their items, each a dataset of its own. */
export interface DicomTag {
  tag: string;
  name: string;
  vr: string;
  value: string;
  group: (typeof DICOM_TAG_GROUPS)[number];
  phi: boolean;
  decoded?: string;
  items?: DicomTag[][];
}

export const dicomTagSchema: z.ZodType<DicomTag, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    /** `(gggg,eeee)`, upper-case hex. */
    tag: z.string(),
    name: z.string(),
    vr: z.string(),
    /** The value in text; bulk data reads `<N bytes>`; a sequence reads `N items`. */
    value: z.string(),
    group: dicomTagGroupSchema,
    /** True when the tag identifies a person or an institution. */
    phi: z.boolean(),
    /** Words for a coded value, when the kernel knows them. */
    decoded: z.string().optional(),
    items: z.array(z.array(dicomTagSchema)).optional(),
  }),
);

/** A tag whose value changes across a folder's files. */
export const dicomVaryingTagSchema = z.object({
  tag: z.string(),
  name: z.string(),
  vr: z.string(),
  group: dicomTagGroupSchema,
  phi: z.boolean(),
  /** Distinct values across the files that carry the tag. */
  distinct: z.number(),
  /** The value in the first file, in stack order. */
  first: z.string(),
  /** The value in the last file, in stack order. */
  last: z.string(),
  /** Every file's value in stack order; a file without the tag carries null. */
  values: z.array(z.object({ path: z.string(), value: z.string().nullable() })),
});

/**
 * The `dicom.tags` model. For a file, `constant` holds every element and
 * `varying` is empty. For a folder, `constant` is what every file shares
 * and `varying` what changes, with `read` files out of `of` in the folder
 * when the folder was sampled.
 */
export const dicomTagsModelSchema = z.object({
  path: z.string(),
  subject: z.enum(['file', 'folder']),
  /** Files read, and files in the folder; equal unless sampled. */
  read: z.number(),
  of: z.number(),
  /** Files that could not be read or parsed. */
  refused: z.array(z.string()),
  constant: z.array(dicomTagSchema),
  varying: z.array(dicomVaryingTagSchema),
});

/** The voxel grid, from one header. */
export const dicomGeometrySchema = z.object({
  rows: z.number(),
  columns: z.number(),
  pixelSpacing: z.tuple([z.number(), z.number()]).optional(),
  sliceThickness: z.number().optional(),
  spacingBetweenSlices: z.number().optional(),
});

/**
 * The `dicom.series` model: one folder as a series. Order names how the
 * files were stacked: `filename` when each starts with its InstanceNumber
 * (oxidicom's naming), `unknown` when they were merely sorted by name.
 */
export const dicomSeriesModelSchema = z.object({
  path: z.string(),
  seriesInstanceUID: z.string().optional(),
  studyInstanceUID: z.string().optional(),
  modality: z.string(),
  seriesDescription: z.string(),
  seriesNumber: z.number().optional(),
  /** DICOM files in the folder. */
  instances: z.number(),
  /** Frames in the header read; one for a classic single-frame file. */
  frames: z.number(),
  order: z.enum(['filename', 'unknown']),
  geometry: dicomGeometrySchema.optional(),
  transferSyntax: z.object({ uid: z.string(), name: z.string().optional() }).optional(),
  /** Sum of the folder's DICOM file sizes. */
  bytes: z.number(),
  /** The file whose header answered, first in stack order. */
  header: z.string(),
  /** Files in stack order. */
  files: z.array(z.string()),
  /** Annotation files found for the series' UID. */
  annotations: z.array(z.string()),
});

export type DicomTagGroup = z.infer<typeof dicomTagGroupSchema>;
export type DicomVaryingTag = z.infer<typeof dicomVaryingTagSchema>;
export type DicomTagsModel = z.infer<typeof dicomTagsModelSchema>;
export type DicomGeometry = z.infer<typeof dicomGeometrySchema>;
export type DicomSeriesModel = z.infer<typeof dicomSeriesModelSchema>;

/** The DICOM models' envelope kinds. */
export const DICOM_MODEL_KINDS = {
  tags: 'dicom.tags',
  series: 'dicom.series',
} as const;
