/**
 * @file Shared prompt rendering utilities.
 * @module
 */

/**
 * Returns the visible (non-ANSI) length of a string.
 *
 * @param s - String possibly containing ANSI escape codes.
 * @returns Number of visible columns.
 */
export function ansi_visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Truncates a filesystem path to fit within `maxLen` visible columns.
 *
 * Drops leading path segments (oldest ancestors) replacing them with
 * `...`, then — if the leaf alone still exceeds the budget — truncates
 * the leaf itself from the front.
 *
 * @param path - Absolute or relative path string.
 * @param maxLen - Maximum number of visible columns allowed.
 * @returns Truncated path string (no ANSI codes).
 */
export function path_truncate(path: string, maxLen: number): string {
  if (maxLen <= 0) return '...';
  if (path.length <= maxLen) return path;

  const segments: string[] = path.split('/').filter(Boolean);

  for (let drop: number = 1; drop < segments.length; drop++) {
    const candidate: string = '.../' + segments.slice(drop).join('/');
    if (candidate.length <= maxLen) return candidate;
  }

  const leaf: string = segments[segments.length - 1] ?? path;
  const budget: number = maxLen - 3;
  return '...' + leaf.slice(-Math.max(budget, 0));
}
