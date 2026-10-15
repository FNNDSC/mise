/**
 * @file Help lists every command: each declares a category `help` knows, or
 * stands on the games shelf (its own page). A command added without one fails
 * here, so it cannot go missing from `help` (#1102).
 */
import { describe, it, expect } from '@jest/globals';
import { helpText, HELP_CATEGORIES } from '../src/builtins/help.js';
import { chrisHelp } from '../src/chris/help.js';
import { GAMES_SHELF } from '../src/builtins/games/shelf.js';

describe('help categories', () => {
  const shelf: Set<string> = new Set(GAMES_SHELF.flatMap((category) => category.commands));
  const entries = Object.entries({ ...helpText, ...chrisHelp }).filter(([name]) => !name.includes(' '));

  it('every command declares a category help lists, or is on the games shelf', () => {
    const missing: string[] = entries
      .filter(([name, help]) => !shelf.has(name) && (help.category === undefined || !HELP_CATEGORIES.includes(help.category)))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('places the workflow verbs that went missing from help', () => {
    const of = (name: string): string | undefined => ({ ...helpText, ...chrisHelp })[name]?.category;
    expect([of('play'), of('gather'), of('record'), of('expect')]).toEqual(['Workflows & Cohorts', 'Workflows & Cohorts', 'Workflows & Cohorts', 'Workflows & Cohorts']);
    expect([of('query'), of('pull')]).toEqual(['PACS', 'PACS']);
    expect(of('url')).toBe('Sharing & Tags');
  });
});
