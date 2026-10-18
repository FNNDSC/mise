/**
 * @file trek isolation — bsd-trek imports nothing of mise.
 *
 * bsd-trek is the trek game as a package anyone can install, and the
 * engine the session's `trek` and ARGUS's bridge both consume
 * (docs/trek.adoc). It is built inside mise as if it came from outside: its
 * sources import only their own modules, Node's, and the dependencies its
 * package.json names; its package.json names nothing of @fnndsc. Anything
 * the game needs from mise becomes part of mise's public contract instead
 * of a reach into its internals.
 *
 * It also holds the port's naming line. A function ported from the C keeps
 * the C's name, so the port reads side by side with NetBSD's sources, and so
 * does a stand-in for a C library call (`printf`, `getchar`, `srandom`);
 * everything the port added is named `object_verb`. A name that is not
 * `object_verb` passes only when its JSDoc names it as the C's: a line
 * `C: \`dowarp()\`` or "stands in for C's getchar()".
 *
 * A hard check with no baseline: the count is zero and stays zero. Run via
 * `npm run lint:trek`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** The house name of a function or method: `object_verb`. */
const RPN_PATTERN = /^[a-z][A-Za-z0-9]*_[a-z][A-Za-z0-9]*$/;

/**
 * Recursively collects .ts source files under a directory.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} out - Accumulator for matched file paths.
 * @returns {string[]} The accumulator.
 */
function sourceFiles_collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles_collect(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const trekRoot = new URL('../packages/trek/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(trekRoot, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(manifest.dependencies ?? {}));
const violations = [];

/**
 * Whether a module specifier is one bsd-trek may import.
 *
 * @param {string} spec - The specifier.
 * @returns {string | null} Why not, or null when it may.
 */
function specifier_refusal(spec) {
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('./')) return null;
  if (spec.startsWith('../')) return spec.startsWith('../package.json') ? null : 'reaches outside its own folder';
  if (spec.startsWith('@fnndsc/')) return 'imports mise';
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return declared.has(name) ? null : 'is not a declared dependency';
}

// TypeScript's own scanner names every module a file imports, re-exports or
// loads dynamically, and reads no string or comment as one.
for (const file of sourceFiles_collect(join(trekRoot, 'src'), [])) {
  const text = readFileSync(file, 'utf8');
  for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
    const why = specifier_refusal(imported.fileName);
    if (why !== null) {
      const line = text.slice(0, imported.pos).split('\n').length;
      violations.push(`  ${file.slice(trekRoot.length)}:${line}  ${imported.fileName} ${why}`);
    }
  }
}

/**
 * Whether a function's JSDoc names it as the C's own.
 *
 * @param {string} doc - The JSDoc text.
 * @param {string} name - The function's name.
 * @returns {boolean} True when a `C:` line or a stand-in line names it.
 */
function doc_checkNamesC(doc, name) {
  return doc.includes(`C: \`${name}()\``) || doc.includes(`C's ${name}()`) || doc.includes(`C's \`${name}()\``);
}

/**
 * Collects the functions, methods and function-valued fields of one file
 * whose names are neither `object_verb` nor the C's own.
 *
 * @param {string} file - The source file.
 * @returns {string[]} One violation line for each.
 */
function names_refuse(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const refused = [];
  const node_visit = (node) => {
    let name = null;
    let documented = node;
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) && node.name) name = node.name.getText(source);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      name = node.name.text;
      documented = node.parent.parent;
    }
    if (ts.isPropertySignature(node) && node.type && ts.isFunctionTypeNode(node.type)) name = node.name.getText(source);
    if (name !== null && name !== 'constructor' && !RPN_PATTERN.test(name)) {
      const doc = ts.getJSDocCommentsAndTags(documented).map((d) => d.getText(source)).join('\n');
      if (!doc_checkNamesC(doc, name)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        refused.push(`  ${file.slice(trekRoot.length)}:${line}  ${name} is not object_verb, and its JSDoc names no C original`);
      }
    }
    ts.forEachChild(node, node_visit);
  };
  node_visit(source);
  return refused;
}

for (const file of [...sourceFiles_collect(join(trekRoot, 'src'), []), ...sourceFiles_collect(join(trekRoot, 'tests'), [])]) {
  violations.push(...names_refuse(file));
}

for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (name.startsWith('@fnndsc/')) violations.push(`  package.json ${field}: ${name}`);
  }
}

if (violations.length > 0) {
  console.error(`trek-isolation: ${violations.length} import(s) or name(s) bsd-trek may not have.`);
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log('trek-isolation: bsd-trek imports only itself, Node and its declared dependencies; every name is object_verb or the C\'s own.');
