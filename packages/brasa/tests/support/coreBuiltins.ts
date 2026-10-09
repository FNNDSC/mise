/**
 * @file Stubs the builtin modules the command groups import one by one.
 *
 * The core group, and the ChRIS group beside its barrel import, take some
 * handlers from the module that defines them. A test that stubs the builtins
 * wholesale stubs those modules too, with the same functions it stubs
 * elsewhere; which modules they are is read from the groups' own imports, so
 * the two cannot drift.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';

const groupSource: string = ['../../src/core/coreCommands.ts', '../../src/chris/chrisCommands.ts']
  .map((group: string): string => readFileSync(new URL(group, import.meta.url), 'utf8'))
  .join('\n');

/**
 * The functions and constants a builtin module exports, read from its source.
 *
 * @param module - The module's path under `src/builtins`, as imported (`.js`).
 * @returns Its exported names.
 */
function moduleFunctions_read(module: string): string[] {
  const source: string = readFileSync(new URL(`../../src/builtins/${module.replace(/\.js$/, '.ts')}`, import.meta.url), 'utf8');
  return [...source.matchAll(/^export (?:async function|function|const) (\w+)/gm)].map((match: RegExpMatchArray): string => match[1]);
}

/** Each builtin module a group imports by name (not the barrel), with what it exports. */
const CORE_MODULES: ReadonlyArray<[string, string[]]> = [...new Set([...groupSource.matchAll(/import \{[^}]*\} from '\.\.\/builtins\/([^']+)';/g)]
  .map((match: RegExpMatchArray): string => match[1])
  .filter((module: string): boolean => module !== 'index.js'))]
  .map((module: string): [string, string[]] => [`../../src/builtins/${module}`, moduleFunctions_read(module)]);

/**
 * Mocks every builtin module the core group imports: a function the test
 * stubs answers with its stub, any other with a fresh `jest.fn()`.
 *
 * @param stubs - The test's stubs, by export name.
 */
export function coreBuiltins_mock(stubs: Record<string, unknown>): void {
  for (const [path, names] of CORE_MODULES) {
    jest.unstable_mockModule(path, () => Object.fromEntries(names.map((name: string): [string, unknown] => [name, stubs[name] ?? jest.fn()])));
  }
}
