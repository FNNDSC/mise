/**
 * Resolve hook for the core boot: any import of a ChRIS package is refused
 * and recorded, so a refusal swallowed by a try/catch still fails the run.
 */
import { appendFileSync } from 'node:fs';

const CHRIS = /^@fnndsc\/(cumin|salsa|chili)(\/|$)/;

export async function resolve(specifier, context, next) {
  if (CHRIS.test(specifier)) {
    const record = process.env.CORE_BOOT_LOADS;
    if (record) appendFileSync(record, `${specifier} <- ${context.parentURL ?? '?'}\n`);
    throw new Error(`core boot: ${specifier} is a ChRIS package (imported from ${context.parentURL ?? '?'})`);
  }
  return next(specifier, context);
}
