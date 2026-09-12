/**
 * @file A fingerprint of how the surface LOOKS, so a refactor can prove it did not change it.
 *
 * Written for the clean-room: ARGUS's layout is moving out of TheLCARS.com's
 * stylesheet and into our own, and the operator's condition is that the LCARS
 * look survive the move exactly. A screenshot cannot answer that — an eye does
 * not catch two pixels — and no assertion anyone would think to write covers a
 * frame that is subtly wrong.
 *
 * So this reads the COMPUTED style of every element, which is the browser's own
 * answer to "what does this look like", after every stylesheet has had its say.
 * Take a baseline before the work, take another after, and diff: zero
 * differences is the proof, and any difference is named down to the property.
 *
 * Usage:
 *   node tests/smoke/themeSnapshot.mjs <out.json> [theme]
 *   node tests/smoke/themeSnapshot.mjs --diff <before.json> <after.json>
 *
 * @module
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { page_open } from './driver.mjs';

/**
 * The properties that carry the look.
 *
 * Geometry, colour, type and the box — everything an operator would notice, and
 * nothing that merely reflects where the page happens to be scrolled.
 */
const WATCHED = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'background-color', 'color', 'border-top-color', 'opacity', 'visibility',
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height',
  'text-align', 'text-transform', 'white-space', 'overflow-x', 'overflow-y',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows', 'z-index', 'box-shadow',
  // What actually DRAWS the frame's signature shapes. Every one of these was
  // absent while four pseudo-elements went missing and the diff read zero:
  // the elbow's fillet is a background-image, PHAROS cuts its stone with
  // clip-path, the nameplate is a mask, and `content` is what says a
  // pseudo-element exists at all.
  'content', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'clip-path', 'mask-image', 'filter', 'transform',
  'animation-name', 'animation-duration', 'transition-property',
  'border-top-style', 'border-left-style', 'outline-width', 'outline-color',
];

/** Reads the page and returns one record per element. */
const SNAPSHOT_SCRIPT = (watched) => `
  const watched = ${JSON.stringify(watched)};
  /** A stable name for an element: its position in the tree, plus what it is. */
  const key_of = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const parent = node.parentElement;
      const index = parent ? [...parent.children].indexOf(node) : 0;
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']'
        + (node.id ? '#' + node.id : '')
        + (node.className && typeof node.className === 'string'
            ? '.' + node.className.trim().split(/\\s+/).join('.') : ''));
    }
    return parts.join('>');
  };
  const out = {};
  // The console transcript and a listing's rows are CONTENT: they differ run to
  // run because the session did different things, and a fingerprint that moves
  // on its own proves nothing. The frame is what is under test.
  // The latency readout shows only once a reading has landed, so it is present
  // or absent depending on the wire, not the theme.
  const SKIP = ['.argus-output', '.listing-field', '#pacs-results', '#files-results',
    '.dag-canvas', '#status-latency', '#drawer-status'];
  // An element and the two boxes it can draw without owning a node. The frame's
  // masks, fillets, lit bands and lens rings all live in ::before and ::after,
  // and a fingerprint that reads only elements cannot see any of them — which
  // is how a rebuild dropped four of them and still diffed clean.
  const record = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    if (pseudo && (cs.content === 'none' || cs.display === 'none')) return;
    const rec = {};
    // A url() carries the daemon's origin, which changes every run and says
    // nothing about the look. Keep the asset, drop the host.
    for (const p of watched) {
      rec[p] = cs.getPropertyValue(p).replace(/url\\("https?:\\/\\/[^/]+\\//g, 'url("');
    }
    if (pseudo) {
      // A pseudo-element has no node to measure, so its own box is the record.
      rec['@box'] = [cs.width, cs.height].join('x');
    } else {
      const r = el.getBoundingClientRect();
      rec['@box'] = [Math.round(r.width), Math.round(r.height)].join('x');
    }
    out[key_of(el) + (pseudo ?? '')] = rec;
  };
  for (const el of document.querySelectorAll('*')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    if (SKIP.some((s) => el.closest(s) !== null)) continue;
    record(el, null);
    record(el, '::before');
    record(el, '::after');
  }
  return out;
`;

/**
 * Diffs two snapshots and prints every difference.
 *
 * @param before - The baseline snapshot.
 * @param after - The snapshot to hold to it.
 * @returns The number of differing properties.
 */
function diff_report(before, after) {
  let differences = 0;
  const onlyBefore = Object.keys(before).filter((k) => !(k in after));
  const onlyAfter = Object.keys(after).filter((k) => !(k in before));
  for (const key of onlyBefore) console.log(`GONE     ${key}`);
  for (const key of onlyAfter) console.log(`NEW      ${key}`);
  differences += onlyBefore.length + onlyAfter.length;
  for (const key of Object.keys(before)) {
    if (!(key in after)) continue;
    for (const prop of Object.keys(before[key])) {
      const a = before[key][prop];
      const b = after[key][prop];
      if (a !== b) {
        console.log(`CHANGED  ${key}\n           ${prop}: ${a}  ->  ${b}`);
        differences++;
      }
    }
  }
  return differences;
}

if (process.argv[2] === '--diff') {
  const before = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const after = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const differences = diff_report(before, after);
  console.log(differences === 0
    ? `\n✓ identical — ${Object.keys(before).length} elements, ${WATCHED.length + 1} properties each`
    : `\n✗ ${differences} difference(s) across ${Object.keys(before).length} elements`);
  process.exit(differences === 0 ? 0 : 1);
}

const out = process.argv[2];
const theme = process.argv[3];
if (!out) {
  console.error('usage: themeSnapshot.mjs <out.json> [theme]   |   --diff <before> <after>');
  process.exit(2);
}
const page = await page_open(process.env.ARGUS_URL);
const evalIn = (body) =>
  page.eval('(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ' + body + ' })()');
try {
  await evalIn('for (let i = 0; i < 200; i++) { if (/READY/.test(document.getElementById("drawer-status")?.textContent ?? "")) return; await sleep(200); }');
  // The chrome breathes, so `filter` and anything mid-transition reads
  // differently depending on when the snapshot lands. Stop every clock first,
  // and the fingerprint measures the stylesheet rather than the moment.
  await evalIn(`const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.append(still); await sleep(400); return 1;`);
  if (theme) {
    await evalIn(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      document.body.setAttribute('data-theme', ${JSON.stringify(theme)}); await sleep(1500); return 1;`);
  }
  // Every pane on stage, so the snapshot covers the whole surface rather than
  // whichever preset happened to be up.
  await evalIn(`document.getElementById('gutter-tools').click(); await sleep(1500); return 1;`);
  const snapshot = await evalIn(SNAPSHOT_SCRIPT(WATCHED));
  writeFileSync(out, JSON.stringify(snapshot, null, 1));
  console.log(`${Object.keys(snapshot).length} elements × ${WATCHED.length + 1} properties -> ${out}`);
} finally {
  page.close();
}
