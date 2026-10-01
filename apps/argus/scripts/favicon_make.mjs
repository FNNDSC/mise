#!/usr/bin/env node
/**
 * @file The tab icon, made from the vendored ChRIS logo.
 *
 * One source — src/assets/brand/ChRISlogo-color.svg — three outputs: the
 * surface's `public/favicon.svg` (the logo on a black rounded square, the
 * page's own ground), a `favicon.png` of it for the browsers and home
 * screens that take no SVG icon, and porter's copy of the SVG as a module,
 * so the door and the greeter wear the same mark as the surface they open.
 * The PNG is rendered by a headless chromium when one is on the path;
 * without one the SVG and the module are still written.
 *
 * Run: node scripts/favicon_make.mjs   (from apps/argus)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const argus = resolve(here, '..');
const brand = readFileSync(join(argus, 'src/assets/brand/ChRISlogo-color.svg'), 'utf-8');

// The logo's own drawing, less its XML prologue and outer element: nested
// as an inner <svg> with its own viewBox, it scales into the square whole.
const inner = brand
  .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/<sodipodi:namedview[\s\S]*?\/>/, '');
const viewBox = /viewBox="([^"]+)"/.exec(brand)?.[1] ?? '0 0 111 78';

// 128 square: black ground with the surface's corner radius, the logo
// centred at four fifths of the width so it reads at 16px.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#000"/>
  <svg x="12" y="27" width="104" height="74" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>
</svg>
`;

mkdirSync(join(argus, 'public'), { recursive: true });
writeFileSync(join(argus, 'public/favicon.svg'), favicon);

const porterModule = `/**
 * @file The door's tab icon: the same mark as the surface it opens, written
 * by apps/argus/scripts/favicon_make.mjs. Do not edit by hand.
 */
export const FAVICON_SVG: string = ${JSON.stringify(favicon)};
`;
writeFileSync(resolve(argus, '../porter/src/favicon.ts'), porterModule);

// The PNG: chromium renders the SVG at 192px for the icons that take no SVG.
const chromium = ['chromium', 'chromium-browser', 'google-chrome'].find((name) => spawnSync('which', [name]).status === 0);
if (chromium === undefined) {
  console.log('favicon.svg and porter/src/favicon.ts written; no chromium on the path, favicon.png left as it was');
} else {
  const work = join(tmpdir(), `favicon-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const page = join(work, 'icon.html');
  writeFileSync(page, `<!doctype html><html><body style="margin:0;background:#000">${favicon.replace('width="128" height="128"', 'width="192" height="192"')}</body></html>`);
  const out = join(argus, 'public/favicon.png');
  const run = spawnSync(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(work, 'profile')}`, '--hide-scrollbars', '--window-size=192,192', `--screenshot=${out}`, `file://${page}`], { stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
  console.log(run.status === 0 && existsSync(out) ? 'favicon.svg, favicon.png and porter/src/favicon.ts written' : 'favicon.svg and porter/src/favicon.ts written; the PNG render failed');
}
