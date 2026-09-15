/**
 * @file Materializes ARGUS's voice from the original TheLCARS.com beeps.
 *
 * The operator asked for the real LCARS sounds back; the synthesised ones
 * (scripts/sounds_make.mjs) are the committed fallback. TheLCARS.com's
 * template is free to USE but its EULA forbids REDISTRIBUTION, so the beeps
 * are never committed: this extracts them from the operator's own
 * `LCARS-26.zip` into `public/sounds/*.mp3`, which `.gitignore` keeps out of
 * the repo. index.html prefers the `.mp3` and falls back to the committed
 * `.wav`, so a clone without the zip still has a voice.
 *
 * Zip discovery: the `LCARS_ZIP` environment variable, then
 * `~/Downloads/LCARS-26.zip`. The four beeps map to the four events in
 * order: press, arrive, retreat, refuse.
 *
 * Run: `node scripts/sounds_import.mjs` (or `npm run sounds:import`).
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(APP_ROOT, 'public', 'sounds');

/** beep<n> in the template, and the event it becomes here. */
const MAP = [
  { beep: 'beep1.mp3', event: 'press.mp3' },
  { beep: 'beep2.mp3', event: 'arrive.mp3' },
  { beep: 'beep3.mp3', event: 'retreat.mp3' },
  { beep: 'beep4.mp3', event: 'refuse.mp3' },
];

/** Finds the template zip, or null. */
function zip_locate() {
  const candidates = [process.env.LCARS_ZIP, path.join(homedir(), 'Downloads', 'LCARS-26.zip')];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const zip = zip_locate();
  if (zip === null) {
    console.log('sounds: no LCARS-26.zip found (set LCARS_ZIP or place it in ~/Downloads);');
    console.log('sounds: the synthesised .wav fallback stays in use.');
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const { beep, event } of MAP) {
    // unzip -p streams one member to stdout; write it under the event name.
    const bytes = execFileSync('unzip', ['-p', zip, `LCARS-26/assets/${beep}`]);
    if (bytes.length === 0) {
      console.log(`sounds: ${beep} not in ${path.basename(zip)}; skipped.`);
      continue;
    }
    writeFileSync(path.join(OUT, event), bytes, { mode: 0o644 });
    console.log(`sounds: ${beep} -> public/sounds/${event}`);
  }
  console.log('sounds: the original beeps play; they are gitignored (EULA: no redistribution).');
}

main();
