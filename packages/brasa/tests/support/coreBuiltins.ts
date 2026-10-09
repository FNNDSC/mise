/**
 * @file Stubs the builtin modules the core command group imports.
 *
 * The core group imports each of its handlers from the module that defines
 * it. A test that stubs the builtins wholesale stubs those modules too, with
 * the same functions it stubs elsewhere; which modules they are is read from
 * the group's own imports, so the two cannot drift.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';

const groupSource: string = readFileSync(new URL('../../src/core/coreCommands.ts', import.meta.url), 'utf8');

/**
 * The functions a builtin module exports, read from its source.
 *
 * @param module - The module's path under `src/builtins`, as imported (`.js`).
 * @returns Its exported function names.
 */
function moduleFunctions_read(module: string): string[] {
  const source: string = readFileSync(new URL(`../../src/builtins/${module.replace(/\.js$/, '.ts')}`, import.meta.url), 'utf8');
  return [...source.matchAll(/^export (?:async )?function (\w+)/gm)].map((match: RegExpMatchArray): string => match[1]);
}

/** Each builtin module the core group imports, with every function it exports. */
const CORE_MODULES: ReadonlyArray<[string, string[]]> = [...groupSource.matchAll(/import \{[^}]*\} from '\.\.\/builtins\/([^']+)';/g)]
  .map((match: RegExpMatchArray): [string, string[]] => [`../../src/builtins/${match[1]}`, moduleFunctions_read(match[1])]);

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
