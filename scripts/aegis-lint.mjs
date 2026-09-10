/**
 * @file The AEGIS doctrine gate.
 *
 * Statically enforces the machine-checkable laws of apps/argus/docs/aegis.adoc
 * ("The laws" table) against the argus surface, and enforces the table itself:
 * every law must name an enforcement that exists (a check in this file, or a
 * scenario string present in the smoke suite). Doctrine cannot be written
 * without teeth.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const html = readFileSync('apps/argus/index.html', 'utf8');
const css = readFileSync('apps/argus/src/lcars/argus.css', 'utf8');
const aegis = readFileSync('apps/argus/docs/aegis.adoc', 'utf8');
const smoke = readFileSync('apps/argus/tests/smoke/smoke.mjs', 'utf8');
const sources = ['apps/argus/src/app/main.ts', 'apps/argus/src/console/argusLang.ts']
  .map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));

/** Every feature panel's source, by path. */
const features = readdirSync('apps/argus/src/features', { recursive: true })
  .filter((name) => String(name).endsWith('.ts'))
  .map((name) => `apps/argus/src/features/${String(name).replaceAll('\\', '/')}`)
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

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

LINT_CHECKS['ordinals-mark-channels'] = () => {
  const gutter = html.match(/<div class="left-frame">([\s\S]*?)<\/div>\n\s*<div class="right-frame">/);
  if (!gutter) { fail('ordinals-mark-channels', 'left-frame gutter not found'); return; }
  const buttons = [...gutter[1].matchAll(/<button class="([^"]*)"[^>]*>([A-Z]+)(?:<span class="hop">([^<]*)<\/span>)?<\/button>/g)];
  if (buttons.length === 0) { fail('ordinals-mark-channels', 'no gutter buttons parsed'); return; }
  let expected = 1;
  for (const [, cls, label, hop] of buttons) {
    const isMeta = cls.includes('panel-lang');
    if (isMeta) {
      if (hop !== undefined) fail('ordinals-mark-channels', `meta given ${label} carries an ordinal '${hop}'`);
      continue;
    }
    const m = (hop ?? '').match(/^-(\d\d)$/);
    if (!m) { fail('ordinals-mark-channels', `channel ${label} lacks a -0N ordinal`); continue; }
    if (Number(m[1]) !== expected) {
      fail('ordinals-mark-channels', `channel ${label} is -${m[1]}, expected -${String(expected).padStart(2, '0')} (sequential down the column)`);
    }
    expected += 1;
  }
};

LINT_CHECKS['field-is-content'] = () => {
  // A pane's field carries content only. Display modes live on the mode
  // frame (a strip at rest); nothing floats over the field.
  const frames = [...html.matchAll(/<aside class="mode-frame">[\s\S]*?<\/aside>/g)].map((m) => m[0]).join('\n');
  const pills = [...html.matchAll(/<button class="strategy-pill[^"]*"/g)].length;
  const framed = [...frames.matchAll(/<button class="strategy-pill[^"]*"/g)].length;
  if (pills !== framed) fail('field-is-content', `${pills - framed} mode pill(s) live outside a mode frame`);
  for (const pane of panes_extract()) {
    if (pane.name !== 'tpl-pane-dag' && pane.name !== 'tpl-pane-files') continue;
    if (!pane.body.includes('class="mode-strip"')) fail('field-is-content', `${pane.name} has modes but no mode strip`);
    const field = pane.body
      .replace(/<div class="pane-drawer"[\s\S]*?<\/div>/, '')
      .replace(/<aside class="mode-frame">[\s\S]*?<\/aside>/g, '')
      .replace(/<button class="mode-strip"[^>]*><\/button>/g, '');
    for (const m of field.matchAll(/<button[^>]*>/g)) {
      fail('field-is-content', `${pane.name} field carries a control: ${m[0].slice(0, 60)}`);
    }
  }
  // A repealed law's enforcement must be deleted with it: the floating rail
  // (2026-08-31) was repealed 2026-09-03, and its CSS must not survive to
  // enforce the repeal's opposite.
  if (/\.(dag|files)-rail\b/.test(css)) fail('field-is-content', 'a floating-rail rule survives in argus.css');
  if (/\b(dag|files)-rail\b/.test(html)) fail('field-is-content', 'a floating-rail element survives in index.html');
};

LINT_CHECKS['hover-never-glares'] = () => {
  // A hover brightens a control in its own hue; it never flips it to the
  // palette's near-white (butter), which reads as a glare on the frame.
  for (const m of css.matchAll(/([^{}]+):hover[^{]*\{([^}]*)\}/g)) {
    if (/--butter/.test(m[2])) fail('hover-never-glares', `hover rule on '${m[1].trim().split(/\s*,\s*/).pop()}' uses --butter`);
  }
};

LINT_CHECKS['roster-grid-single-source'] = () => {
  // Caps and rows read one declaration: any roster grid that spells its own
  // template has drifted from the caps (or will).
  // The façade's row grid, the caps, and the PACS grids that S4 will fold in.
  for (const selector of ['.roster-caps', '.listing-row', '#pacs-form']) {
    const m = css.match(new RegExp(`\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`));
    if (!m) { fail('roster-grid-single-source', `${selector} rule not found`); continue; }
    if (!/grid-template-columns:\s*var\(--roster-cols\)/.test(m[1])) fail('roster-grid-single-source', `${selector} does not read --roster-cols`);
  }
  for (const m of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
    if (/\d(em|px|fr)\b/.test(m[1]) && /1fr/.test(m[1]) && /em/.test(m[1]) && !/var\(--roster-cols\)/.test(m[1])) {
      // a hand-spelled roster-shaped template outside the single source
      const before = css.slice(0, m.index);
      const host = before.slice(before.lastIndexOf('\n\n')).trim().split('\n')[0];
      if (/--roster-cols:/.test(m[0])) continue;
      if (/roster-cols/.test(before.slice(-200))) continue;
      if (/(listing-row|files-grid|feedlist-row|roster-caps)/.test(host)) fail('roster-grid-single-source', `${host} spells its own roster template`);
    }
  }
};

LINT_CHECKS['surface-never-shadows-the-session'] = () => {
  // The language runs client-side BEFORE a line reaches the session, so a
  // subject that is also a kernel command silently swallows it. A shared
  // subject must claim only the verbs the session does not have, and say so
  // in SHARED_SUBJECTS; every other subject must collide with nothing.
  const lang = sources.find((s) => s.path.endsWith('argusLang.ts'));
  if (lang === undefined) { fail('surface-never-shadows-the-session', 'argusLang.ts not read'); return; }
  const subjects = lang.text.match(/const SUBJECTS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/);
  if (subjects === null) { fail('surface-never-shadows-the-session', 'SUBJECTS set not found'); return; }
  const names = [...subjects[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const shared = lang.text.match(/const SHARED_SUBJECTS[\s\S]*?\n\};/);
  const sharedNames = shared === null ? [] : [...shared[0].matchAll(/^  ([a-z]+):/gm)].map((m) => m[1]);
  // The session's own vocabulary, from the one place it is declared.
  const dispatch = readFileSync('packages/brasa/src/core/dispatch.ts', 'utf8');
  const block = dispatch.slice(dispatch.indexOf('ENVELOPE_HANDLERS: Record<string, EnvelopeHandler> = {'));
  const commands = new Set([...block.slice(0, block.indexOf('\n};')).matchAll(/^\s{2}'?([a-z][\w-]*)'?:/gm)].map((m) => m[1]));
  for (const name of names) {
    if (!commands.has(name)) continue;
    if (!sharedNames.includes(name)) {
      fail('surface-never-shadows-the-session', `subject '${name}' shadows the session command of the same name and is not declared shared`);
    }
  }
};

LINT_CHECKS['a-preview-is-the-same-drawing'] = () => {
  // A card and the stage draw the same graph, so they read one placement.
  // They did not always: the card spread each tier evenly while the scene
  // hung a tree of leaf slots, and nobody chose that — the two were written
  // separately and could not help but differ.
  const layout = 'apps/argus/src/scene/rankedLayout.ts';
  if (!existsSync(layout)) {
    fail('a-preview-is-the-same-drawing', 'the shared ranked layout is gone');
    return;
  }
  const drawers = [
    'apps/argus/src/scene/dagScene.ts',
    'apps/argus/src/features/files/panel.ts',
  ];
  for (const path of drawers) {
    const text = readFileSync(path, 'utf8');
    if (!/rankedLayout_compute\(/.test(text)) {
      fail('a-preview-is-the-same-drawing', `${path} draws a ranked graph without reading the shared layout`);
    }
    // The tell of a second layout: computing depth or tiers locally.
    if (/const\s+(depths|tiers)\s*:\s*Map</.test(text)) {
      fail('a-preview-is-the-same-drawing', `${path} computes its own tiers`);
    }
  }
};

LINT_CHECKS['listing-is-one-abstraction'] = () => {
  // The listing is the Listing façade in features/roster: a pane DECLARES
  // its listing and never builds one. Reaching past the façade to the parts
  // — the order, the host, the row and capsule builders — is the violation,
  // because that is how three panes came to spell the same table three
  // ways, and then the same action track, indication and readout twice.
  //
  // No allowances: every pane declares. The PACS pane's, which expired
  // with S4, was the last.
  const ALLOWED_UNTIL_S4 = new Set([]);
  const REACHING = [
    [/new RosterOrder</, 'builds a RosterOrder itself'],
    [/new ListingHost</, 'builds a ListingHost itself'],
    [/\blistingRow_build\(/, 'builds rows itself (listingRow_build)'],
    [/\bactionCell_build\(/, 'builds action capsules itself (actionCell_build)'],
    [/\btraitColumns_of\(|\btraitValue_of\(/, 'derives caps or comparators itself (traitColumns_of / traitValue_of)'],
    [/from '\.\.\/roster\/(order|host)\.js'/, 'imports the order or the host, which only the façade may'],
  ];
  for (const { path, text } of features) {
    if (path.startsWith('apps/argus/src/features/roster/')) continue;
    if (/'roster-caps?'/.test(text)) fail('listing-is-one-abstraction', `${path} builds its own column caps`);
    if (/'roster-filter/.test(text)) fail('listing-is-one-abstraction', `${path} builds its own filter strip`);
    const reaches = REACHING.filter(([pattern]) => pattern.test(text)).map(([, what]) => what);
    if (reaches.length === 0) continue;
    if (ALLOWED_UNTIL_S4.has(path)) {
      console.log(`aegis-lint: debt — ${path} still reaches past the Listing façade (${reaches.join('; ')}); allowed until S4 converts it`);
      continue;
    }
    for (const what of reaches) fail('listing-is-one-abstraction', `${path} reaches past the Listing façade: ${what}`);
  }
  // The stylesheet reaches past it too when it spells a track list by
  // hand: `--roster-cols` is the façade's to write, computed from the
  // traits. No selector may declare one.
  const ALLOWED_TRACK_HOSTS_UNTIL_S4 = [];
  for (const m of css.matchAll(/--roster-cols:/g)) {
    const before = css.slice(0, m.index);
    const host = before.slice(before.lastIndexOf('\n\n')).trim().split('\n')[0].replace(/\s*\{.*$/, '').trim();
    if (host.startsWith('*') || host.startsWith('/*')) continue; // a comment mentioning the property
    if (ALLOWED_TRACK_HOSTS_UNTIL_S4.some((allowed) => host === allowed)) continue;
    fail('listing-is-one-abstraction', `${host} declares --roster-cols by hand; the façade computes it from the traits`);
  }
};

LINT_CHECKS['a-component-lands-with-its-reference'] = () => {
  // The reference beneath the doctrine: one section per component a pane
  // declares into. Every section names a source that exists, and every
  // source that IS a component has a section — so a component cannot land
  // without its reference, and a reference cannot outlive its component.
  const COMPONENT_SOURCES = [
    'apps/argus/src/features/roster/listing.ts',
    'apps/argus/src/features/image/panel.ts',
  ];
  if (!existsSync('apps/argus/docs/components.adoc')) {
    fail('a-component-lands-with-its-reference', 'apps/argus/docs/components.adoc is missing');
    return;
  }
  const reference = readFileSync('apps/argus/docs/components.adoc', 'utf8');
  const sections = [...reference.matchAll(/^== (.+)$\n([\s\S]*?)(?=^== |(?![\s\S]))/gm)]
    .map(([, title, body]) => ({ title: title.trim(), body }))
    .filter(({ title }) => title !== 'Abstract' && title !== 'Reading a section');
  if (sections.length === 0) fail('a-component-lands-with-its-reference', 'components.adoc has no component sections');
  const named = new Set();
  for (const { title, body } of sections) {
    const source = body.match(/^Source: `([^`]+)`/m);
    if (!source) { fail('a-component-lands-with-its-reference', `section '${title}' names no Source`); continue; }
    if (!existsSync(source[1])) fail('a-component-lands-with-its-reference', `section '${title}' names a source that does not exist: ${source[1]}`);
    named.add(source[1]);
    for (const part of ['=== Purpose', '=== Anatomy', '=== Declaration', '=== States', '=== Laws', '=== Stylesheet', '=== Do not']) {
      if (!body.includes(part)) fail('a-component-lands-with-its-reference', `section '${title}' lacks '${part}'`);
    }
    // The anatomy is drawn, not only described: a picture a reader can
    // point at, checked into the tree beside the words.
    const anatomy = body.match(/^=== Anatomy$\n([\s\S]*?)(?=^=== )/m);
    const image = anatomy?.[1].match(/^image::([^\[]+)\[/m);
    if (!image) fail('a-component-lands-with-its-reference', `section '${title}' has no anatomy drawing (image:: under === Anatomy)`);
    else if (!existsSync(`apps/argus/docs/${image[1]}`)) fail('a-component-lands-with-its-reference', `section '${title}' names a drawing that does not exist: ${image[1]}`);
  }
  for (const source of COMPONENT_SOURCES) {
    if (!existsSync(source)) fail('a-component-lands-with-its-reference', `component source missing: ${source}`);
    if (!named.has(source)) fail('a-component-lands-with-its-reference', `${source} is a component with no section in components.adoc`);
  }
};

LINT_CHECKS['a-component-names-no-theme'] = () => {
  // A component and its reference speak the component's own vocabulary —
  // caps, strip, frame, field, track, expanse, level, group — and name no
  // theme. Colour reaches them as tokens, never as LCARS by name, so
  // another theme can sit on the same declaration without a rename. AEGIS
  // is where the theme is named, as the origin of the grammar; the parts
  // beneath it describe a listing, not a look.
  const THEME = /lcars/i;
  const componentSources = readdirSync('apps/argus/src/features/roster', { recursive: true })
    .filter((name) => String(name).endsWith('.ts'))
    .map((name) => `apps/argus/src/features/roster/${String(name).replaceAll('\\', '/')}`);
  for (const path of [...componentSources, 'apps/argus/docs/components.adoc']) {
    const text = readFileSync(path, 'utf8');
    const line = text.split('\n').findIndex((l) => THEME.test(l));
    if (line >= 0) fail('a-component-names-no-theme', `${path}:${line + 1} names the theme; a component speaks its own vocabulary`);
  }
};

LINT_CHECKS['an-instruments-field-is-foreign'] = () => {
  // An image pane's field is a guest engine's and the frame is mise's:
  // every control the pane offers rides the mode frame, and nothing sits
  // over the image. The template is the declaration: its field section
  // carries no button, input or block.
  const template = html.match(/<template id="tpl-pane-image">([\s\S]*?)<\/template>/);
  if (!template) { fail('an-instruments-field-is-foreign', 'index.html has no tpl-pane-image template'); return; }
  const field = template[1].match(/<section class="image-field"[^>]*>([\s\S]*?)<\/section>/);
  if (!field) { fail('an-instruments-field-is-foreign', 'tpl-pane-image has no .image-field section'); return; }
  if (/<(button|input|select|textarea)\b|strategy-pill|pacs-capsule/.test(field[1])) {
    fail('an-instruments-field-is-foreign', 'a control sits inside .image-field; what acts on the field rides the frame');
  }
  if (!/class="mode-frame"[\s\S]*?image-tool/.test(template[1])) {
    fail('an-instruments-field-is-foreign', 'the image pane\'s tool blocks are not on its mode frame');
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
