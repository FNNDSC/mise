/**
 * @file Shared normalization for plugin executable selectors.
 *
 * Direct execution and composite commands use this module to resolve `/bin`-style
 * plugin names through the same exact-name and optional-version query grammar.
 *
 * @module
 */

/**
 * Normalize a `/bin` plugin name into a ChRIS plugin search selector.
 *
 * @param selector - Plugin name, optionally ending in `-v<version>`.
 * @returns Exact-name selector with an exact version when one was supplied.
 */
export function pluginSelector_normalize(selector: string): string {
  const match: RegExpMatchArray | null = selector.match(/^(.+)-v(.+)$/);
  if (match === null) return `name_exact:${selector}`;
  return `name_exact:${match[1]},version:${match[2]}`;
}
