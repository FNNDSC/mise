/**
 * @file Prompt parity — argus's prompt theme must match chell's by value.
 *
 * argus duplicates chell's Powerlevel10k palette and glyph set rather than
 * importing them, because a browser surface may not import the execution
 * stack. The duplication is defensible; its silence is not. It produced two
 * defects at once and neither was caught by types, tests or review: every
 * glyph codepoint had degraded to an empty string (which presented as a
 * missing Nerd Font, though the font was fine and was being handed nothing to
 * draw), and the PACS segment was never rendered despite arriving on the wire.
 *
 * This compares the two sources by value. An empty glyph fails, a diverged
 * colour fails, and a glyph chell defines that argus never adopted is
 * reported but not fatal — argus renders a subset of chell's segments by
 * design.
 *
 * Enforces known violation 4 in docs/principles.adoc; see issue #223. Run via
 * `npm run lint:prompt`.
 *
 * @module
 */

import { readFileSync } from 'node:fs';

const argusPath = new URL('../apps/argus/src/console/terminal.ts', import.meta.url).pathname;
const themePath = new URL('../packages/chell/src/core/prompt/theme_p10k.ts', import.meta.url).pathname;
const palettePath = new URL('../packages/chell/src/core/prompt/palette.ts', import.meta.url).pathname;

/** argus glyph name to the chell constant it must equal. */
const GLYPH_MAP = {
  powerline: 'POWERLINE',
  cube: 'ICON_CUBE',
  database: 'ICON_DATABASE',
  user: 'ICON_USER',
  folder: 'ICON_FOLDER',
  microscope: 'ICON_MICROSCOPE',
  bolt: 'ICON_BOLT',
  error: 'ICON_ERROR',
};

/** argus palette key to the chell PROMPT_PALETTE key it must equal. */
const PALETTE_MAP = {
  pacs: 'PACS',
  host: 'HOST',
  user: 'USER',
  dir: 'DIR',
  physical: 'PHYSICAL',
  duration: 'DURATION',
  status: 'STATUS',
};

/**
 * Resolves a source-level string literal to its actual characters, so that a
 * `\u`-escaped form and a literal character compare equal.
 *
 * @param {string} literal - The literal's inner text, without quotes.
 * @returns {string} The characters the literal denotes.
 */
function literal_decode(literal) {
  return literal.replace(/\\u\{?([0-9a-fA-F]+)\}?/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}

const argusText = readFileSync(argusPath, 'utf8');
const themeText = readFileSync(themePath, 'utf8');
const paletteText = readFileSync(palettePath, 'utf8');

const argusGlyphs = Object.fromEntries(
  [...(argusText.match(/const GLYPHS = \{[\s\S]*?\} as const;/) ?? [''])[0]
    .matchAll(/(\w+):\s*'([^']*)'/g)].map(([, key, value]) => [key, literal_decode(value)]),
);

const argusPalette = Object.fromEntries(
  [...(argusText.match(/const SEGMENT_PALETTE[\s\S]*?\n\};/) ?? [''])[0]
    .matchAll(/(\w+):\s*\{\s*bg:\s*'([^']*)',\s*fg:\s*'([^']*)'/g)]
    .map(([, key, bg, fg]) => [key, `${bg.toUpperCase()}/${fg.toUpperCase()}`]),
);

const chellPalette = Object.fromEntries(
  [...paletteText.matchAll(/(\w+):\s*\{\s*bg:\s*'([^']*)',\s*fg:\s*'([^']*)'\s*\}/g)]
    .map(([, key, bg, fg]) => [key, `${bg.toUpperCase()}/${fg.toUpperCase()}`]),
);

const failures = [];

for (const [argusName, chellName] of Object.entries(GLYPH_MAP)) {
  const actual = argusGlyphs[argusName];
  const declared = themeText.match(
    new RegExp(String.raw`const ${chellName}:\s*string\s*=\s*'([^']*)'`),
  );
  if (declared === null) {
    failures.push(`  ${chellName} not found in theme_p10k.ts — has the theme moved?`);
    continue;
  }
  const expected = literal_decode(declared[1]);
  if (actual === undefined) {
    failures.push(`  GLYPHS.${argusName} is missing (chell defines ${chellName})`);
  } else if (actual.length === 0) {
    failures.push(`  GLYPHS.${argusName} is empty — the codepoint was lost in re-encoding`);
  } else if (actual !== expected) {
    const show = (s) => [...s].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ');
    failures.push(`  GLYPHS.${argusName} is ${show(actual)}, chell's ${chellName} is ${show(expected)}`);
  }
}

for (const [argusKey, chellKey] of Object.entries(PALETTE_MAP)) {
  const actual = argusPalette[argusKey];
  const expected = chellPalette[chellKey];
  if (expected === undefined) {
    failures.push(`  PROMPT_PALETTE.${chellKey} not found in palette.ts — has the palette moved?`);
  } else if (actual === undefined) {
    failures.push(`  SEGMENT_PALETTE.${argusKey} is missing (chell defines ${chellKey})`);
  } else if (actual !== expected) {
    failures.push(`  SEGMENT_PALETTE.${argusKey} is ${actual}, chell's ${chellKey} is ${expected}`);
  }
}

if (failures.length > 0) {
  console.error(`prompt-parity: ${failures.length} divergence(s) between argus and chell's prompt theme.`);
  console.error("argus duplicates the theme by value because it may not import the execution");
  console.error('stack. That duplication is only safe while something checks it. Update');
  console.error('apps/argus/src/console/terminal.ts to match, keeping glyphs as \\u escapes so');
  console.error('the codepoints survive re-encoding. See docs/principles.adoc, violation 4.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const glyphCount = Object.keys(GLYPH_MAP).length;
const paletteCount = Object.keys(PALETTE_MAP).length;
console.log(`prompt-parity: ${glyphCount} glyphs and ${paletteCount} segments match chell's p10k theme.`);
