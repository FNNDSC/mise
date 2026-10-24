/**
 * @file RPN prepositions — a method is a verb.
 *
 * Functions are named `<subject>[Qualifier]_<verb>[Adverb]` (the style
 * guide's RPN). A preposition where the verb goes (`answerRows_of`,
 * `seriesUID_ofPath`, `x_to`, `y_forKind`) names the result and stops: it
 * does not say whether the function fetches, derives, parses or renders,
 * which is what a reader needs at the call site. This gate refuses one.
 *
 * Checked: function declarations, `const` function expressions and arrows,
 * and class and interface methods whose name has an underscore. A
 * preposition after the verb is an adverb and stands (`x_readFromCache`).
 *
 * The rule was written when the habit had spread to 461 declarations
 * (#1227), all renamed in the change that added it.
 *
 * Run via `npm run lint:rpn`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/** A method that is, or starts with, one of these is a preposition. */
const PREPOSITION = /^(of|to|with|from|for|by|as|in|on|at)([A-Z0-9]|$)/;

/** The repository root. */
const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Recursively collects .ts source files under a directory.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} out - Accumulator for matched file paths.
 * @returns {string[]} The accumulator.
 */
function sources_collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') sources_collect(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The name a node declares as a function, when it declares one.
 *
 * @param {ts.Node} node - Any node.
 * @returns {string | null} The declared name, or null.
 */
function functionName_read(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name.text;
  const method = ts.isMethodDeclaration(node) || ts.isMethodSignature(node)
    || (ts.isPropertySignature(node) && node.type !== undefined && ts.isFunctionTypeNode(node.type));
  if (method && node.name && ts.isIdentifier(node.name) && node.name.text.includes('_')) return node.name.text;
  return null;
}

const roots = ['apps', 'packages'].flatMap((top) => readdirSync(join(ROOT, top), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(ROOT, top, entry.name, 'src')));
const files = roots.flatMap((dir) => { try { return sources_collect(dir, []); } catch { return []; } });

const hits = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    const name = functionName_read(node);
    const method = name?.split('_')[1];
    if (method !== undefined && PREPOSITION.test(method)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      hits.push(`  ${relative(ROOT, file)}:${line}  ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (hits.length > 0) {
  console.error(`rpn-prepositions: ${hits.length} method(s) named by a preposition; name what the function does (derive, build, render, parse, …):`);
  for (const hit of hits) console.error(hit);
  process.exit(1);
}
console.log(`rpn-prepositions: every method in ${files.length} source files is a verb.`);
