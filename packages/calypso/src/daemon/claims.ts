/**
 * @file Surface claims: which lines a surface's own language answers for.
 *
 * A browser carries a language of its own (`dag %1 census on`, `desktop show`,
 * `pane close`). It declares its subjects on attach; a subject the session
 * also owns (`file`, `help`) comes with the verbs the surface claims from it,
 * and every other verb of it stays the session's. A line typed in any chell
 * whose subject is claimed is run by the surface, never by the engine: the
 * law a-surface-never-shadows-the-session, held in one place.
 *
 * Matching reads a line as the surface does: the first word is the subject;
 * for a shared subject, the second word is the verb. Only a single command is
 * routed: a line with a pipe, a list or a redirect is the session's to run.
 *
 * @module
 */

/** One claimed subject: all of it, or only the verbs listed. */
export interface SurfaceClaim {
  subject: string;
  verbs?: string[];
}

/** A line the session runs itself, whatever its first word: a pipe, a list, a redirect. */
const COMPOUND: RegExp = /[|;&<>]/;

/**
 * The claimed subject a line is in, when the line belongs to the surface.
 *
 * @param claims - The surface's claims.
 * @param line - The line typed.
 * @returns The subject, or null when the session owns the line.
 */
export function claim_match(claims: ReadonlyArray<SurfaceClaim>, line: string): string | null {
  const trimmed: string = line.trim();
  if (trimmed === '' || COMPOUND.test(trimmed)) return null;
  const words: string[] = trimmed.split(/\s+/);
  const subject: string = (words[0] ?? '').toLowerCase();
  const claim: SurfaceClaim | undefined = claims.find((one: SurfaceClaim): boolean => one.subject.toLowerCase() === subject);
  if (claim === undefined) return null;
  if (claim.verbs !== undefined && !claim.verbs.map((verb: string): string => verb.toLowerCase()).includes((words[1] ?? '').toLowerCase())) return null;
  return subject;
}

/**
 * Completion candidates the claims add for a line typed so far: subjects for
 * a first word, a shared subject's claimed verbs for a second.
 *
 * @param claims - Every attached surface's claims.
 * @param linePrefix - The line up to the cursor.
 * @returns The candidates the claims offer for the word being completed.
 */
export function claimCandidates_list(claims: ReadonlyArray<SurfaceClaim>, linePrefix: string): string[] {
  if (COMPOUND.test(linePrefix)) return [];
  const words: string[] = linePrefix.replace(/^\s+/, '').split(/\s+/);
  const offered: Set<string> = new Set();
  if (words.length === 1) {
    const typed: string = (words[0] ?? '').toLowerCase();
    for (const claim of claims) if (claim.subject.toLowerCase().startsWith(typed)) offered.add(claim.subject);
  } else if (words.length === 2) {
    const subject: string = (words[0] ?? '').toLowerCase();
    const typed: string = (words[1] ?? '').toLowerCase();
    for (const claim of claims) {
      if (claim.subject.toLowerCase() !== subject || claim.verbs === undefined) continue;
      for (const verb of claim.verbs) if (verb.toLowerCase().startsWith(typed)) offered.add(verb);
    }
  }
  return [...offered].sort();
}
