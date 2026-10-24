/**
 * @file Whether a CUBE folder holds one series, told from where it is.
 *
 * The kernel decides it when a folder is gathered, and a surface decides it
 * when it offers a viewer; one rule in one place keeps the two from
 * disagreeing about the same folder.
 *
 * @module
 */

/** How oxidicom names a series folder: `<SeriesNumber>-<description>-<7 hex of the UID hash>`. */
export const SERIES_FOLDER_PATTERN: RegExp = /^\d+-.*-[0-9a-f]{7}$/;

/** Where CUBE keeps what a PACS has sent. */
export const PACS_TREE_ROOT: string = '/SERVICES/PACS/';

/** How deep a series sits under that root: server, patient, study, series. */
const PACS_SERIES_DEPTH: number = 4;

/**
 * Whether a directory holds one series.
 *
 * Two ways to know, and neither costs a look inside. The NAME is one:
 * oxidicom writes a series folder in a shape nothing else does. The PLACE
 * is the other: inside the PACS tree the depth says what a folder is, so a
 * series stored under some other naming is still a series, and the study
 * above it is still not one.
 *
 * Deliberately not: reading the folder to find out. A verb offered only
 * after a listing of every row's contents is a verb that costs one request
 * per row before the operator has pressed anything.
 *
 * @param path - The folder's full CFS path.
 * @param name - Its own name, the last segment.
 * @returns True when the folder is one series.
 */
export function seriesFolder_is(path: string, name: string): boolean {
  if (SERIES_FOLDER_PATTERN.test(name)) return true;
  if (!path.startsWith(PACS_TREE_ROOT)) return false;
  const below: string = path.slice(PACS_TREE_ROOT.length).replace(/\/+$/, '');
  return below !== '' && below.split('/').length === PACS_SERIES_DEPTH;
}
