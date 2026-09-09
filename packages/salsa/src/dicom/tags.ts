/**
 * @file DICOM tag reading: one parser for every surface.
 *
 * A DICOM file is a dictionary of elements. Reading one here gives every
 * surface the same answer: the tag, its dictionary name and VR, its value in
 * text, the module it belongs to, whether it identifies someone, and words
 * for the coded values a reader meets first. Sequences keep their items.
 * Across a folder, the same reader tells constant from varying: what the
 * series shares against what changes slice by slice.
 *
 * Bulk values (pixel data and friends) are never rendered as bytes; the
 * listing says how many bytes there were. Long text is carried whole on the
 * model; a surface that bounds it says so.
 *
 * @module
 */
import dcmjs from 'dcmjs';
import type { DcmjsDict, DcmjsDictionaryEntry, DcmjsElement } from 'dcmjs';
import { Ok, Err, type Result } from '@fnndsc/cumin';
import { type DicomTagGroup, DICOM_PHI_TAGS, tagGroup_of, tagValue_decode } from './dictionary.js';

/** One element of a DICOM dataset, as every surface sees it. */
export interface DicomTag {
  /** `(gggg,eeee)`, upper-case hex. */
  tag: string;
  /** Dictionary name; `PrivateTag` or `Unknown` when the dictionary has none. */
  name: string;
  vr: string;
  /** The value in text. Multi-valued elements join with `\`; bulk data reads `<N bytes>`. */
  value: string;
  group: DicomTagGroup;
  /** True when the tag identifies a person or an institution. */
  phi: boolean;
  /** Words for a coded value, when the kernel knows them. */
  decoded?: string;
  /** Sequence items, each a dataset of its own. */
  items?: DicomTag[][];
}

/** Everything read from one file. */
export interface DicomTagSet {
  tags: DicomTag[];
  /** From the file meta group; absent for a bare dataset. */
  transferSyntaxUID?: string;
}

/** A tag whose value changes across a folder. */
export interface DicomVaryingTag {
  tag: string;
  name: string;
  vr: string;
  group: DicomTagGroup;
  phi: boolean;
  /** How many distinct values the folder holds. */
  distinct: number;
  /** The value in the first file, in folder order. */
  first: string;
  /** The value in the last file, in folder order. */
  last: string;
  /** Every file's value, in folder order. Files without the tag carry `null`. */
  values: Array<{ path: string; value: string | null }>;
}

/** What a folder of files shares and what changes across it. */
export interface DicomTagsSummary {
  constant: DicomTag[];
  varying: DicomVaryingTag[];
}

/** VRs whose values are bulk bytes, never text. */
const BULK_VRS: ReadonlySet<string> = new Set<string>(['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'UN']);

/** Group numbers whose every element is a sequence item boundary or padding. */
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set<string>(['FFFEE000', 'FFFEE00D', 'FFFEE0DD']);

/**
 * Reads the elements of a DICOM file.
 *
 * @param bytes - The whole file, Part 10 header included.
 * @returns The tag set, or an error when the bytes are not a DICOM file.
 */
export function dicomTags_read(bytes: Buffer): Result<DicomTagSet> {
  const buffer: ArrayBuffer = new Uint8Array(bytes).slice().buffer as ArrayBuffer;
  try {
    const message = dcmjs.data.DicomMessage.readFile(buffer, { ignoreErrors: true });
    const meta: DicomTag[] = dict_flatten(message.meta);
    const body: DicomTag[] = dict_flatten(message.dict);
    const syntax: DicomTag | undefined = meta.find((tag: DicomTag): boolean => tag.name === 'TransferSyntaxUID');
    return Ok({
      tags: [...meta, ...body],
      ...(syntax !== undefined ? { transferSyntaxUID: syntax.value } : {}),
    });
  } catch {
    return Err();
  }
}

/**
 * Turns a raw dictionary into tags, in tag order, sequences nested.
 *
 * @param dict - A dcmjs dictionary keyed by `ggggeeee`.
 * @returns The tags.
 */
function dict_flatten(dict: DcmjsDict): DicomTag[] {
  const keys: string[] = Object.keys(dict)
    .filter((key: string): boolean => /^[0-9A-Fa-f]{8}$/.test(key) && !STRUCTURAL_TAGS.has(key.toUpperCase()))
    .sort();
  return keys.map((key: string): DicomTag => element_toTag(key, dict[key]));
}

/**
 * Renders one element as a tag.
 *
 * @param key - The `ggggeeee` key.
 * @param element - The raw element.
 * @returns The tag.
 */
function element_toTag(key: string, element: DcmjsElement): DicomTag {
  const upper: string = key.toUpperCase();
  const tag: string = `(${upper.slice(0, 4)},${upper.slice(4)})`;
  const groupNumber: number = parseInt(upper.slice(0, 4), 16);
  const entry: DcmjsDictionaryEntry | undefined = dcmjs.data.DicomMetaDictionary.dictionary[tag];
  const isPrivate: boolean = groupNumber % 2 === 1;
  const name: string = entry?.name ?? (isPrivate ? 'PrivateTag' : 'Unknown');
  const vr: string = element.vr || entry?.vr || 'UN';
  const values: unknown[] = element.Value ?? [];

  const result: DicomTag = {
    tag,
    name,
    vr,
    value: '',
    group: tagGroup_of(groupNumber, entry?.name),
    phi: DICOM_PHI_TAGS.has(name),
  };

  if (vr === 'SQ') {
    const items: DicomTag[][] = values.map((item: unknown): DicomTag[] => dict_flatten(item as DcmjsDict));
    result.items = items;
    result.value = `${items.length} item${items.length === 1 ? '' : 's'}`;
    return result;
  }
  if (BULK_VRS.has(vr)) {
    result.value = `<${bulk_bytes(values)} bytes>`;
    return result;
  }
  result.value = values.map((value: unknown): string => value_text(value, vr)).join('\\');
  const decoded: string | undefined = decoded_of(name, result.value);
  if (decoded !== undefined) result.decoded = decoded;
  return result;
}

/**
 * Sums the bytes of a bulk value list.
 *
 * @param values - Buffers or typed arrays.
 * @returns Total byte length.
 */
function bulk_bytes(values: unknown[]): number {
  let total: number = 0;
  for (const value of values) {
    if (value instanceof ArrayBuffer) total += value.byteLength;
    else if (ArrayBuffer.isView(value)) total += value.byteLength;
  }
  return total;
}

/**
 * One value in text. Person names are alphabetic components; everything
 * else is its string form.
 *
 * @param value - The raw value.
 * @param vr - The element's VR.
 * @returns The text.
 */
function value_text(value: unknown, vr: string): string {
  if (vr === 'PN' && value !== null && typeof value === 'object') {
    const parts: Record<string, unknown> = value as Record<string, unknown>;
    return String(parts.Alphabetic ?? parts.Ideographic ?? parts.Phonetic ?? '');
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Words for a coded value: the short dictionary list, plus SOP class UIDs
 * named through dcmjs.
 *
 * @param name - The tag's name.
 * @param value - The tag's text value.
 * @returns Words, or nothing.
 */
function decoded_of(name: string, value: string): string | undefined {
  if (name === 'SOPClassUID' || name === 'MediaStorageSOPClassUID') {
    return dcmjs.data.DicomMetaDictionary.sopClassNamesByUID[value];
  }
  return tagValue_decode(name, value);
}

/**
 * Finds one tag by name in a tag set's top level.
 *
 * @param tags - The tags to search.
 * @param name - The dictionary name.
 * @returns The tag, or undefined.
 */
export function dicomTag_find(tags: DicomTag[], name: string): DicomTag | undefined {
  return tags.find((tag: DicomTag): boolean => tag.name === name);
}

/**
 * Tells constant from varying across a folder's files, in folder order.
 *
 * A tag is constant when every file carries it with the same value
 * (sequences compare by their items). Anything else, including a tag some
 * files lack, is varying, with its first and last value and its distinct
 * count. Files that failed to read are the caller's to report; they are not
 * passed here.
 *
 * @param files - Each file's path and tag set, in folder order.
 * @returns The summary.
 */
export function dicomTags_summarize(files: Array<{ path: string; tags: DicomTagSet }>): DicomTagsSummary {
  const order: string[] = [];
  const byTag: Map<string, Map<string, DicomTag>> = new Map<string, Map<string, DicomTag>>();
  for (const file of files) {
    const seen: Map<string, DicomTag> = new Map<string, DicomTag>();
    for (const tag of file.tags.tags) {
      if (!byTag.has(tag.tag)) {
        byTag.set(tag.tag, new Map<string, DicomTag>());
        order.push(tag.tag);
      }
      seen.set(tag.tag, tag);
    }
    for (const [key, tag] of seen) byTag.get(key)!.set(file.path, tag);
  }

  const constant: DicomTag[] = [];
  const varying: DicomVaryingTag[] = [];
  for (const key of order.sort()) {
    const perFile: Map<string, DicomTag> = byTag.get(key)!;
    const values: Array<{ path: string; value: string | null }> = files.map((file): { path: string; value: string | null } => {
      const tag: DicomTag | undefined = perFile.get(file.path);
      return { path: file.path, value: tag === undefined ? null : tag_comparable(tag) };
    });
    const distinctValues: Set<string | null> = new Set<string | null>(values.map((entry): string | null => entry.value));
    const sample: DicomTag = perFile.values().next().value as DicomTag;
    if (distinctValues.size === 1 && !distinctValues.has(null)) {
      constant.push(sample);
      continue;
    }
    const present: Array<{ path: string; value: string | null }> = values.filter((entry): boolean => entry.value !== null);
    varying.push({
      tag: sample.tag,
      name: sample.name,
      vr: sample.vr,
      group: sample.group,
      phi: sample.phi,
      distinct: distinctValues.size - (distinctValues.has(null) ? 1 : 0),
      first: present[0].value as string,
      last: present[present.length - 1].value as string,
      values: values.map((entry): { path: string; value: string | null } => ({
        path: entry.path,
        value: entry.value === null ? null : perFile.get(entry.path)!.value,
      })),
    });
  }
  return { constant, varying };
}

/**
 * The value a tag is compared by across files: its text, or for a sequence
 * the text of its items.
 *
 * @param tag - The tag.
 * @returns A comparable string.
 */
function tag_comparable(tag: DicomTag): string {
  if (tag.items === undefined) return tag.value;
  return JSON.stringify(tag.items.map((item: DicomTag[]): string[] => item.map((inner: DicomTag): string => `${inner.tag}=${tag_comparable(inner)}`)));
}
