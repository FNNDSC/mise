/**
 * @file Declaration ratchet — every builtin must declare itself.
 *
 * A builtin is currently declared in two unlinked places: `ENVELOPE_HANDLERS`
 * in brasa's dispatch table, which maps a name to a function and carries no
 * metadata, and `helpText` in the help builtin, which carries usage and
 * description. Nothing keeps them in step, and they have drifted.
 *
 * Aliases are resolved before counting. Several commands are registered under
 * both a singular and a plural name bound to the same handler (`compute` and
 * `computes`, `user` and `users`, `pipeline` and `pipelines`), and an alias is
 * not a separate command: it is declared if any name sharing its handler is
 * declared. Counting alias names separately inflates the baseline, and an
 * inflated baseline is slack a real violation can hide in.
 *
 * This counts commands with no corresponding help entry under any of their
 * names. The count is zero, so the check is effectively hard: a new builtin
 * arriving without help fails immediately. The baseline is retained because
 * the underlying duplication is unresolved — one declaration per command
 * (issue #222) is still the real fix — and a future refactor may legitimately
 * need to park a number here.
 *
 * Enforces "One declaration per command" in docs/principles.adoc. Run via
 * `npm run lint:commands`.
 *
 * @module
 */

import { readFileSync } from 'node:fs';

/** Commands with a handler but no declaration, aliases resolved. Lower whenever it drops. */
const BASELINE = 0;

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

/**
 * Maps each command name to the handler function it is bound to, so that names
 * sharing a handler can be recognised as aliases of one command.
 *
 * @param {string} text - The dispatch source.
 * @param {RegExp} opener - Matches the declaration up to its opening brace.
 * @returns {Map<string, string>} Command name to handler expression.
 */
function handlerBindings_extract(text, opener) {
  const start = text.match(opener);
  if (start === null) {
    console.error(`command-declarations: could not locate ${opener} — has the source moved?`);
    process.exit(1);
  }
  const body = text.slice(start.index + start[0].length);
  const end = body.indexOf('\n};');
  const block = end === -1 ? body : body.slice(0, end);
  return new Map(
    [...block.matchAll(/^\s{2}'?([a-z][\w-]*)'?:\s*(.+?),\s*$/gm)].map(
      (match) => [match[1], match[2].trim()],
    ),
  );
}

const bindings = handlerBindings_extract(
  readFileSync(dispatchPath, 'utf8'),
  /ENVELOPE_HANDLERS: Record<string, EnvelopeHandler> = \{/,
);
const declared = literalKeys_extract(
  readFileSync(helpPath, 'utf8'),
  /helpText: Record<string, CommandHelp> = \{/,
);

// Group names by the handler they bind, then judge each group once: a command
// is declared if any of its names carries help.
const byHandler = new Map();
for (const [name, handler] of bindings) {
  const names = byHandler.get(handler) ?? [];
  names.push(name);
  byHandler.set(handler, names);
}

const undeclared = [...byHandler.values()]
  .filter((names) => !names.some((name) => declared.has(name)))
  .map((names) => names.join('/'))
  .sort();
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

const commandCount = new Set(bindings.values()).size;
console.log(
  `command-declarations: ${commandCount} commands (${bindings.size} names incl. aliases), ` +
    `${total} undeclared, at baseline.`,
);
