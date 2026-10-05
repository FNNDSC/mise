/**
 * @file Changeset headlines — the first sentence of a changeset is what an
 * operator reads (epic #897), so it is held to a shape.
 *
 * The surface shows the first sentence of each changeset as a row under
 * WHAT'S NEW and unfolds the rest beneath it. A first sentence that is a
 * paragraph, that opens with a code name, or that speaks our vocabulary
 * (refactor, lint, smoke…) is a row an operator cannot use. A change that
 * is ours alone writes its headline "Internal: …" and the surface hides it
 * by default.
 *
 * Run via `npm run lint:changesets` (after the names check).
 *
 * @module
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prose_split } from './notes-build.mjs';

const root = new URL('..', import.meta.url).pathname;

/** The headline's longest, in characters: one row on a phone's listing. */
const HEADLINE_MAX = 120;
/** Words that mark a sentence as written for us, not the operator. */
const JARGON = /\b(refactor(?:ed|ing|s)?|lint(?:ed|ing|s)?|smoke|tests?|helper|module|seam|façade|facade|typecheck|eslint|jest)\b/i;

const offences = [];
let checked = 0;

for (const file of readdirSync(join(root, '.changeset'))) {
  if (!file.endsWith('.md') || file === 'README.md') continue;
  const text = readFileSync(join(root, '.changeset', file), 'utf8');
  const parts = text.split('---');
  const prose = parts.slice(2).join('---').trim();
  if (prose === '') { offences.push(`  .changeset/${file}: no prose`); continue; }
  checked += 1;
  const { headline } = prose_split(prose);
  const internal = /^internal:/i.test(headline);
  if (headline.length > HEADLINE_MAX) offences.push(`  .changeset/${file}: the first sentence runs ${headline.length} characters (the operator's row holds ${HEADLINE_MAX}): "${headline.slice(0, 60)}…"`);
  if (headline.startsWith('`')) offences.push(`  .changeset/${file}: the first sentence opens with a code name; say what it does for the operator first`);
  if (!internal && JARGON.test(headline)) offences.push(`  .changeset/${file}: the first sentence speaks our vocabulary (${(headline.match(JARGON) ?? [''])[0]}); write it for the operator, or begin it "Internal:"`);
}

if (offences.length > 0) {
  console.error('changeset-headlines: the first sentence is the operator\'s row under WHAT\'S NEW');
  for (const line of offences) console.error(line);
  process.exit(1);
}
console.log(`changeset-headlines: ${checked} changeset(s), every first sentence fit for the operator.`);
