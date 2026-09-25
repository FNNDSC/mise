#!/usr/bin/env node
/**
 * @file The orrery's layers, held apart.
 *
 * orrery keeps three layers — `layout/` (the gearing: pure engines), `draw/`
 * (the spheres), `controls/` (the crank) — and a small `scene/` that
 * composes them. A layer that reaches into another is how a curated garden
 * grows back into a bramble, so the seams are checked, not promised:
 *
 *   - every layer may name the shared vocabulary in `types/`, and nothing else
 *     of another layer;
 *   - `layout/` imports only itself and d3-force-3d: no three.js, no other layer;
 *   - `draw/` never imports `layout/` or `controls/`;
 *   - `controls/` never imports `draw/` or `layout/`;
 *   - nothing in orrery imports a `@fnndsc/*` package: it knows no domain;
 *   - a surface (ARGUS) imports only orrery's public entries
 *     (`@fnndsc/orrery`, `@fnndsc/orrery/layout`), never its insides.
 *
 * Exits non-zero naming every import that crosses a seam.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const ORRERY = join(ROOT, 'packages/orrery/src');
const SURFACES = [join(ROOT, 'apps/argus/src')];
const PUBLIC_ENTRIES = new Set(['@fnndsc/orrery', '@fnndsc/orrery/layout']);
const LAYOUT_PACKAGES = new Set(['d3-force-3d']);

/** Every .ts file under a directory. */
function files_under(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files_under(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Every module specifier a file imports, with its line. */
function imports_of(path) {
  const text = readFileSync(path, 'utf8');
  const found = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const line = text.slice(0, match.index).split('\n').length;
    found.push({ spec: match[1], line });
  }
  return found;
}

/** The orrery layer a path lies in: layout, draw, controls, scene, or root. */
function layer_of(path) {
  const rel = relative(ORRERY, path);
  const first = rel.split(sep)[0];
  return ['layout', 'draw', 'controls', 'scene', 'types'].includes(first) ? first : 'root';
}

const failures = [];
const fail = (path, line, why) => failures.push(`${relative(ROOT, path)}:${line} ${why}`);

for (const path of files_under(ORRERY)) {
  const layer = layer_of(path);
  for (const { spec, line } of imports_of(path)) {
    if (spec.startsWith('@fnndsc/')) { fail(path, line, `imports ${spec}: orrery knows no domain`); continue; }
    if (spec.startsWith('.')) {
      const target = resolve(dirname(path), spec);
      if (!target.startsWith(ORRERY)) { fail(path, line, `imports ${spec}, outside orrery`); continue; }
      const into = layer_of(target);
      if (layer === 'layout' && into !== 'layout' && into !== 'types') fail(path, line, `layout/ imports ${spec} (${into}/): the gearing stands alone`);
      if (layer === 'draw' && (into === 'layout' || into === 'controls')) fail(path, line, `draw/ imports ${spec} (${into}/)`);
      if (layer === 'controls' && (into === 'layout' || into === 'draw')) fail(path, line, `controls/ imports ${spec} (${into}/)`);
      continue;
    }
    if (layer === 'layout' && !LAYOUT_PACKAGES.has(spec) && !spec.startsWith('node:')) {
      fail(path, line, `layout/ imports ${spec}: the gearing takes d3-force-3d and nothing else`);
    }
  }
}

for (const surface of SURFACES) {
  for (const path of files_under(surface)) {
    for (const { spec, line } of imports_of(path)) {
      if (spec.startsWith('@fnndsc/orrery') && !PUBLIC_ENTRIES.has(spec)) fail(path, line, `imports ${spec}: a surface takes orrery's public entries only`);
      if (spec.startsWith('.') && resolve(dirname(path), spec).includes(`${sep}packages${sep}orrery${sep}`)) fail(path, line, `reaches into orrery by path (${spec})`);
    }
  }
}

if (failures.length > 0) {
  console.error('orrery-layers: seams crossed');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`orrery-layers: every seam holds (${files_under(ORRERY).length} orrery files, surfaces clean)`);
