/**
 * @file What a pronoun in a manifest refers to.
 *
 * A workflow says "process what I just gathered" and "check the feed that
 * made", which means something in the session has to remember what the last
 * act produced. These are not new state: they are the addresses the kernel
 * already handed back, kept for the length of the session so a later line
 * can name them without the operator copying an id out of a readout.
 *
 * Deliberately small and deliberately not persisted. A pronoun refers to
 * what THIS session did; a manifest replayed in a new session refers to
 * what that session does, which is the only reading that can be right.
 *
 * @module
 */

/** The feed the session most recently created work in. */
let feedID: number | null = null;
/** The runs the session most recently scheduled. */
let instanceIDs: number[] = [];
/** The PACS query the session most recently asked. */
let queryPath: string | null = null;
/** Where the session's most recent run writes its output. */
let runPlace: string | null = null;

/**
 * Notes the feed work just landed in.
 *
 * @param id - The feed's id.
 */
export function recentFeed_note(id: number): void {
  feedID = id;
}

/**
 * The feed the session most recently worked in.
 *
 * @returns The feed id, or null when this session has made none.
 */
export function recentFeed_get(): number | null {
  return feedID;
}

/**
 * Notes the runs just scheduled.
 *
 * @param ids - The plugin instance ids, in the order they were scheduled.
 */
export function recentRuns_note(ids: number[]): void {
  if (ids.length > 0) instanceIDs = [...ids];
}

/**
 * The runs the session most recently scheduled.
 *
 * @returns The instance ids, empty when this session has scheduled none.
 */
export function recentRuns_get(): number[] {
  return [...instanceIDs];
}

/**
 * Notes where a run's output will land.
 *
 * This is what makes a chain expressible: the next act works on what the
 * last one produced, and only the kernel knows where CUBE put it.
 *
 * @param place - The run's output directory.
 */
export function recentRunPlace_note(place: string): void {
  runPlace = place;
}

/**
 * Where the session's most recent run writes.
 *
 * @returns The output directory, or null when this session has run nothing.
 */
export function recentRunPlace_get(): string | null {
  return runPlace;
}

/**
 * Notes where a PACS answer was written.
 *
 * @param path - The query's projection path.
 */
export function recentQuery_note(path: string): void {
  queryPath = path;
}

/**
 * Where the session's most recent PACS answer lives.
 *
 * @returns The query path, or null when this session has asked nothing.
 */
export function recentQuery_get(): string | null {
  return queryPath;
}

/** Forgets everything, for a test that needs a session with no history. */
export function recent_forget(): void {
  feedID = null;
  instanceIDs = [];
  queryPath = null;
  runPlace = null;
}
