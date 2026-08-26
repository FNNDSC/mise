/**
 * @file Materializes the LCARS Lower Decks theme without redistributing it.
 *
 * TheLCARS.com's template is free to use but its EULA forbids redistribution,
 * so the theme files are never committed: `src/lcars/theme/` is gitignored
 * and this script fills it at build time. When the operator has downloaded
 * the official `LCARS-26.zip` (from https://www.thelcars.com/download.php),
 * the needed files are extracted from it; otherwise a minimal generated stub
 * is written so the build still succeeds with a degraded look. Every real
 * copy of the theme therefore comes from the author's own distribution.
 *
 * Zip discovery order: the `LCARS_ZIP` environment variable, then
 * `~/Downloads/LCARS-26.zip`, then `LCARS-26.zip` beside this app.
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The app root, resolved from this script's location. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where the theme materializes; gitignored. */
const THEME_DIR = path.join(APP_ROOT, 'src', 'lcars', 'theme');
/** The file whose presence marks a materialized theme. */
const THEME_MARKER = path.join(THEME_DIR, 'lower-decks.css');
/** The template members the ARGUS page uses. */
const THEME_MEMBERS = [
  'LCARS-26/assets/lower-decks.css',
  'LCARS-26/assets/Antonio-Regular.woff2',
  'LCARS-26/assets/Antonio-Regular.woff',
  'LCARS-26/assets/Antonio-Bold.woff2',
  'LCARS-26/assets/Antonio-Bold.woff',
  'LCARS-26/assets/beep1.mp3',
  'LCARS-26/assets/beep2.mp3',
  'LCARS-26/assets/beep3.mp3',
  'LCARS-26/assets/beep4.mp3',
];

/**
 * Finds the official template zip on this machine.
 *
 * @returns The zip path, or null when none is present.
 */
function zip_locate() {
  const candidates = [
    process.env.LCARS_ZIP,
    path.join(homedir(), 'Downloads', 'LCARS-26.zip'),
    path.join(APP_ROOT, 'LCARS-26.zip'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extracts the needed theme members flat into the theme directory.
 *
 * @param zipPath - The official template zip.
 */
function theme_extract(zipPath) {
  execFileSync('unzip', ['-o', '-j', zipPath, ...THEME_MEMBERS, '-d', THEME_DIR], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`[argus] LCARS theme materialized from ${zipPath}`);
}

/**
 * Writes a generated stand-in theme: the palette variables and just enough
 * frame styling for the page to render legibly, plus empty sound files so
 * asset references resolve. This is original code, not template content.
 */
function stub_write() {
  const stubCss = `/* Generated stand-in for the LCARS Lower Decks theme.
 * The real theme is not redistributed with this repository; download
 * LCARS-26.zip from https://www.thelcars.com/download.php and rebuild.
 */
:root {
  font-size: 1.375rem;
  color-scheme: dark;
  --lfw: 240px;
  --butter: #fec;
  --daybreak: #f91;
  --harvestgold: #fa4;
  --honey: #fc9;
  --october-sunset: #f40;
  --orange: #f70;
  --pumpkin-pie: #c50;
}
body {
  margin: 0;
  background: black;
  color: var(--butter);
  font-family: 'Arial Narrow', sans-serif;
}
.wrap { display: flex; padding: 5px 15px 0 5px; }
.left-frame-top, .left-frame { width: var(--lfw); text-align: right; color: black; font-weight: bold; }
.left-frame-top { background: var(--october-sunset); border-radius: 20px 0 0 0; }
.left-frame button, .left-frame-top button { display: block; width: 100%; border: none; padding: 0.5rem; background: var(--orange); color: black; font-weight: bold; text-align: right; }
.right-frame-top, .right-frame { flex: 1; padding-left: 6px; }
.banner { color: var(--orange); font-size: 1.5rem; text-transform: uppercase; }
.data-cascade-button-group, .bar-panel, .headtrim, .baseboard, .panel-spacer { display: none; }
main { padding: 1rem 0 0 1rem; }
footer { padding: 1rem; font-size: 0.6rem; }
footer a { color: var(--orange); }
`;
  mkdirSync(THEME_DIR, { recursive: true });
  writeFileSync(THEME_MARKER, stubCss);
  for (const sound of ['beep1.mp3', 'beep2.mp3', 'beep3.mp3', 'beep4.mp3']) {
    writeFileSync(path.join(THEME_DIR, sound), Buffer.alloc(0));
  }
  for (const font of ['Antonio-Regular.woff2', 'Antonio-Regular.woff', 'Antonio-Bold.woff2', 'Antonio-Bold.woff']) {
    writeFileSync(path.join(THEME_DIR, font), Buffer.alloc(0));
  }
  console.warn(
    '[argus] LCARS-26.zip not found; built with the generated stand-in theme.\n' +
      '[argus] For the real look: download LCARS-26.zip from https://www.thelcars.com/download.php\n' +
      '[argus] into ~/Downloads (or set LCARS_ZIP), then rebuild.',
  );
}

if (existsSync(THEME_MARKER)) {
  process.exit(0);
}
const zipPath = zip_locate();
if (zipPath !== null) {
  theme_extract(zipPath);
} else {
  stub_write();
}
