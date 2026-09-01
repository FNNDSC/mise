/**
 * @file The AEGIS doctrine gate.
 *
 * Statically enforces the machine-checkable laws of apps/argus/docs/aegis.adoc
 * ("The laws" table) against the argus surface, and enforces the table itself:
 * every law must name an enforcement that exists (a check in this file, or a
 * scenario string present in the smoke suite). Doctrine cannot be written
 * without teeth.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync('apps/argus/index.html', 'utf8');
const css = readFileSync('apps/argus/src/lcars/argus.css', 'utf8');
const aegis = readFileSync('apps/argus/docs/aegis.adoc', 'utf8');
const smoke = readFileSync('apps/argus/tests/smoke/smoke.mjs', 'utf8');
const sources = ['apps/argus/src/app/main.ts', 'apps/argus/src/console/argusLang.ts']
  .map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));

const failures = [];
const fail = (law, detail) => failures.push(`${law}: ${detail}`);

/** All checks this file implements, by law id. */
const LINT_CHECKS = {};

// ------------------------------------------------------------------ helpers

/** Extracts each workspace pane's markup (templates and static panes). */
function panes_extract() {
  const panes = [];
  for (const m of html.matchAll(/<template id="(tpl-pane-[a-z]+)">([\s\S]*?)<\/template>/g)) {
    panes.push({ name: m[1], body: m[2] });
  }
  const staticPane = html.match(/<div class="workspace-pane" id="pacs-workspace">([\s\S]*?)\n {12}<\/div>\n/);
  if (staticPane) panes.push({ name: 'pacs-workspace', body: staticPane[1] });
  return panes;
}

/** Extracts the inner markup of every terminal-header bar. */
function bars_extract() {
  // A header bar always terminates in its end-cap; capture through the cap
  // rather than guessing at the next sibling (a comment between siblings
  // once made this swallow a drawer's buttons into the "bar").
  return [...html.matchAll(/<div class="lcars-terminal-header-bar[^"]*"[^>]*>([\s\S]*?<div class="lcars-bar-end[^"]*"[^>]*>[^<]*<\/div>)/g)]
    .map((m) => m[1]);
}

// ------------------------------------------------------------------- checks

LINT_CHECKS['drawer-everywhere'] = () => {
  for (const pane of panes_extract()) {
    if (!pane.body.includes('pane-handle')) fail('drawer-everywhere', `${pane.name} has no pane-handle`);
    if (!pane.body.includes('pane-drawer')) fail('drawer-everywhere', `${pane.name} has no pane-drawer`);
    for (const group of ['drawer-structure', 'drawer-binding']) {
      if (!pane.body.includes(group)) fail('drawer-everywhere', `${pane.name} drawer lacks ${group}`);
    }
    for (const verb of ['drawer-zoom', 'drawer-close']) {
      if (!pane.body.includes(verb)) fail('drawer-everywhere', `${pane.name} drawer lacks ${verb}`);
    }
  }
};

LINT_CHECKS['bar-no-machinery'] = () => {
  for (const bar of bars_extract()) {
    if (/<button/.test(bar)) fail('bar-no-machinery', `a bar carries a <button>: ${bar.trim().slice(0, 60)}…`);
    if (/role="button"/.test(bar)) fail('bar-no-machinery', `a bar element carries role="button": ${bar.trim().slice(0, 60)}…`);
  }
};

LINT_CHECKS['caps-are-punctuation'] = () => {
  for (const m of html.matchAll(/<div class="(lcars-bar-end[^"]*)"([^>]*)>([^<]*)<\/div>/g)) {
    const [, cls, attrs, text] = m;
    if (!cls.includes('bar-punctuation')) fail('caps-are-punctuation', `end-cap without bar-punctuation: class="${cls}"`);
    if (text.trim() !== '') fail('caps-are-punctuation', `end-cap carries text "${text.trim()}"`);
    if (attrs.includes('role=')) fail('caps-are-punctuation', `end-cap carries a role: ${attrs.trim()}`);
  }
};

LINT_CHECKS['lid-is-mute'] = () => {
  const lid = html.match(/<div class="bar-panel" id="drawer-toggle"[^>]*>([\s\S]*?)<\/div>\n\s*<main>/);
  if (!lid) { fail('lid-is-mute', 'lid bar-panel not found'); return; }
  for (const seg of lid[1].matchAll(/<div class="(bar-\d+)"[^>]*>([^<]*)<\/div>/g)) {
    if (seg[2].trim() !== '') fail('lid-is-mute', `${seg[1]} carries text "${seg[2].trim()}"`);
  }
};

LINT_CHECKS['single-animation-author'] = () => {
  // A class is animation-bearing only when the animation is declared on a
  // selector whose SUBJECT (last compound) carries that class. A state
  // class an ancestor selector reacts to (e.g. .drawer-closed gating a
  // descendant's beckon) is the correct single-author pattern: CSS decides
  // what animates under the state.
  const animated = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, selectors, block] = m;
    if (!/animation:\s*(?!none)[a-z]/.test(block)) continue;
    for (const selector of selectors.split(',')) {
      const subject = selector.trim().split(/[\s>+~]+/).pop() ?? '';
      for (const cls of subject.matchAll(/\.([a-z-]+)/g)) animated.add(cls[1]);
    }
  }
  for (const { path, text } of sources) {
    for (const m of text.matchAll(/classList\.(?:add|toggle)\(\s*'([^']+)'/g)) {
      if (animated.has(m[1])) {
        fail('single-animation-author', `${path} stamps animation-bearing class '${m[1]}'`);
      }
    }
  }
};

// -------------------------------------------------- the table enforces itself

const lawsTable = aegis.match(/\| Law \| Statement \| Enforcement\n([\s\S]*?)\n\|===/);
if (!lawsTable) {
  fail('laws-table', 'no "The laws" table found in aegis.adoc');
} else {
  const rows = [...lawsTable[1].matchAll(/^\| ([a-z-]+) \| .*? \| (lint|smoke):(.+)$/gm)];
  if (rows.length === 0) fail('laws-table', 'laws table has no parseable rows');
  for (const [, law, kind, ref] of rows) {
    if (kind === 'lint') {
      if (!(ref.trim() in LINT_CHECKS)) fail('laws-table', `law '${law}' names missing lint check '${ref.trim()}'`);
    } else if (!smoke.includes(ref.trim())) {
      fail('laws-table', `law '${law}' names a smoke scenario not found in smoke.mjs: "${ref.trim()}"`);
    }
  }
}

for (const [name, run] of Object.entries(LINT_CHECKS)) {
  try { run(); } catch (error) { fail(name, `check crashed: ${error.message}`); }
}

if (failures.length > 0) {
  console.error(`aegis-lint: ${failures.length} violation(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`aegis-lint: all laws hold (${Object.keys(LINT_CHECKS).length} lint checks, table verified)`);
