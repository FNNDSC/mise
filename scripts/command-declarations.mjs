/**
 * @file Declaration ratchet — every builtin must declare itself.
 *
 * A builtin is currently declared in two unlinked places: `ENVELOPE_HANDLERS`
 * in brasa's dispatch table, which maps a name to a function and carries no
 * metadata, and `helpText` in the help builtin, which carries usage and
 * description. Nothing keeps them in step, and they have drifted.
 *
 * This counts handlers with no corresponding help entry and holds the number
 * to a baseline that may only fall. It is a ratchet rather than a hard check
 * because the real fix is a single declaration per command (issue #222), which
 * is a larger change than any one commit should be forced to make; what the
 * ratchet prevents is a *new* command arriving undeclared.
 *
 * Enforces "One declaration per command" in docs/principles.adoc. Run via
 * `npm run lint:commands`.
 *
 * @module
 */

import { readFileSync } from 'node:fs';

/** Commands with a handler but no declaration. Lower this whenever it drops. */
const BASELINE = 4;

const dispatchPath = new URL('../packages/brasa/src/core/dispatch.ts', import.meta.url).pathname;
const helpPath = new URL('../packages/brasa/src/builtins/help.ts', import.meta.url).pathname;

/**
 * Extracts the keys of an object literal assigned to a named constant.
 *
 * @param {string} text - The source file's contents.
 * @param {RegExp} opener - Matches the declaration up to its opening brace.
 * @returns {Set<string>} The literal's top-level keys.
 */
function literalKeys_extract(text, opener) {
  const start = text.match(opener);
  if (start === null) {
    console.error(`command-declarations: could not locate ${opener} — has the source moved?`);
    process.exit(1);
  }
  const body = text.slice(start.index + start[0].length);
  const end = body.indexOf('\n};');
  const block = end === -1 ? body : body.slice(0, end);
  return new Set(
    [...block.matchAll(/^\s{2}'?([a-z][\w-]*)'?:/gm)].map((match) => match[1]),
  );
}

const handlers = literalKeys_extract(
  readFileSync(dispatchPath, 'utf8'),
  /ENVELOPE_HANDLERS: Record<string, EnvelopeHandler> = \{/,
);
const declared = literalKeys_extract(
  readFileSync(helpPath, 'utf8'),
  /helpText: Record<string, CommandHelp> = \{/,
);

const undeclared = [...handlers].filter((name) => !declared.has(name)).sort();
const total = undeclared.length;

if (total > BASELINE) {
  console.error(`command-declarations: ${total} builtin(s) have a handler and no declaration, baseline is ${BASELINE}.`);
  console.error('A command declares itself in one place. A new handler needs its usage and');
  console.error('description alongside it — the same metadata help, completion and any');
  console.error('future assistant all read. See "One declaration per command" in');
  console.error('docs/principles.adoc, and issue #222 for the unification.');
  console.error(undeclared.map((name) => `  ${name}`).join('\n'));
  process.exit(1);
}

if (total < BASELINE) {
  console.error(`command-declarations: undeclared count fell to ${total} (baseline ${BASELINE}) — good.`);
  console.error(`Lower BASELINE to ${total} in scripts/command-declarations.mjs as part of this`);
  console.error('change so the improvement locks in.');
  process.exit(1);
}

console.log(`command-declarations: ${total} undeclared builtin(s), at baseline (${undeclared.join(', ')}).`);
