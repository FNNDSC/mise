/**
 * @file Mocks cumin for a test, and mirrors its generic pieces onto their homes.
 *
 * brasa reads `Result` and the error stack from fond, and the command
 * envelope and its helpers from menu; cumin re-exports them for its other
 * callers. A test written against cumin's names (a fake `errorStack`, a stub
 * `envelope_error`) keeps meaning what it meant: the same fakes answer from
 * fond and menu, and everything else there stays real.
 */
import { jest } from '@jest/globals';

/** Names brasa reads from fond. */
const FOND_NAMES: ReadonlyArray<string> = [
  'Result', 'Ok', 'Err', 'result_isOk', 'result_isErr', 'errorStack', 'errorStack_configure', 'errorStack_getAllOfType', 'StackMessage',
];

/** Names brasa reads from menu. */
const MENU_NAMES: ReadonlyArray<string> = ['CommandEnvelope', 'envelope_ok', 'envelope_error', 'envelope_isOk'];

const actualFond: Record<string, unknown> = await import('@fnndsc/fond');
const actualMenu: Record<string, unknown> = await import('@fnndsc/menu');

/**
 * The entries of a module mock that name one of the given exports.
 *
 * @param made - The mock module.
 * @param names - The exports wanted.
 * @returns Those entries.
 */
function entries_pick(made: Record<string, unknown>, names: ReadonlyArray<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(made).filter(([name]): boolean => names.includes(name)));
}

/** Further fond and menu exports a test fakes. */
export interface SeamFakes {
  fond?: Record<string, unknown>;
  menu?: Record<string, unknown>;
}

/**
 * Mocks `@fnndsc/cumin` with a factory, and fond and menu with the generic
 * pieces that factory gives (built once, so a fake is one object wherever it
 * is reached).
 *
 * @param factory - The cumin mock's factory.
 * @param fakes - Further fond and menu exports the test fakes.
 */
export function cuminMock_install(
  factory: () => unknown,
  fakes: SeamFakes = {},
): void {
  let made: Promise<Record<string, unknown>> | null = null;
  const once = (): Promise<Record<string, unknown>> => (made ??= Promise.resolve(factory() as Record<string, unknown>));
  jest.unstable_mockModule('@fnndsc/cumin', once);
  jest.unstable_mockModule('@fnndsc/fond', async () => ({ ...actualFond, ...entries_pick(await once(), FOND_NAMES), ...fakes.fond }));
  jest.unstable_mockModule('@fnndsc/menu', async () => ({ ...actualMenu, ...entries_pick(await once(), MENU_NAMES), ...fakes.menu }));
}
