/**
 * @file Listing bounds — a listing shows what is there.
 *
 * mise does not default to a page and call it an answer. A caller that wants
 * a collection walks it; a caller that wants a page says so, and the surface
 * states the bound. What this gate forbids is the third thing: a literal
 * `limit:` above one handed to a list call as though it were everything.
 *
 * The rule was written after `ls /net/pacs/queries` answered with 100 of
 * 1,817 stored queries and said nothing about the other 1,717 (#401).
 *
 * A call that genuinely wants a bounded window — the newest row, a probe for
 * existence, an explicit page an operator asked for — says so on the line or
 * the line above with `listing-bound:` and a reason. That comment is the
 * whole exemption mechanism: it costs one line and leaves the reason where
 * the next reader is.
 *
 * Run via `npm run lint:listings`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A limit of one or two fetches a known record, not a page of a collection. */
const SMALL = 2;

/** `limit: <n>` and `limit = <n>` in source, with the number captured. */
const PATTERN = /\blimit\s*[:=]\s*(\d+)/g;

/**
 * Call shapes that fetch ONE page and hand it back. A limit reaching one of
 * these is the bug this gate is for.
 */
const SINGLE_PAGE = [
  'resources_getList',
  'resources_listAndFilterByOptions',
  'Page_get(',
  'getUserFiles(',
  'getUserPermissions(',
  'getPipelineSourceFiles(',
  'getPluginParameters(',
  'pacsQueries_list(',
];

/**
 * Accessors that walk a collection to exhaustion. A limit handed to one of
 * these is a page size, not an answer, and the walk overrides it anyway.
 */
const WALKERS = ['resources_getAll', 'files_listAll', '_drain(', 'listPages_walk'];

/** The marker that declares a bound deliberate, with its reason. */
const EXEMPT = 'listing-bound:';

/**
 * Recursively collects .ts source files under a directory, skipping tests.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} out - Accumulator for matched file paths.
 * @returns {string[]} The accumulator.
 */
function sourceFiles_collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles_collect(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const packagesDir = new URL('../packages', import.meta.url).pathname;
const offences = [];
let exempted = 0;

for (const pkg of readdirSync(packagesDir)) {
  let files;
  try {
    files = sourceFiles_collect(join(packagesDir, pkg, 'src'), []);
  } catch {
    continue; // package without a src dir
  }
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // Prose about a limit is not a limit.
      if (/^\s*(\*|\/\/)/.test(line)) return;
      for (const match of line.matchAll(PATTERN)) {
        const value = Number(match[1]);
        if (value <= SMALL) continue;
        // A call can open a few lines above its options object.
        const context = lines.slice(Math.max(0, index - 3), index + 2).join('\n');
        if (WALKERS.some((walker) => context.includes(walker))) continue;
        if (!SINGLE_PAGE.some((call) => context.includes(call))) continue;
        if (context.includes(EXEMPT)) {
          exempted += 1;
          continue;
        }
        offences.push(`  ${file.slice(packagesDir.length + 1)}:${index + 1}  ${line.trim()}`);
      }
    });
  }
}

if (offences.length > 0) {
  console.error(`listing-bounds: ${offences.length} bounded list call(s) with nothing said about the bound.`);
  console.error('A listing either walks the collection or states the bound it was given.');
  console.error(`Walk it, or mark the line \`${EXEMPT} <why this window is the answer>\`.`);
  console.error(offences.join('\n'));
  process.exit(1);
}

console.log(`listing-bounds: no silent page limits (${exempted} declared bound${exempted === 1 ? '' : 's'}).`);
