/**
 * @file The argus smoke suite: UI invariants against a live daemon.
 *
 * Every scenario here exists because its violation shipped once:
 *   - drawer-everywhere: PACS-03 had no pane controls behind Ctrl-B.
 *   - zoom-completeness: offsetHeight left a crushed header band on stage.
 *   - lid-parity: closed-state overrides wrapped the lid's tail segments.
 *   - single-beckon-author: a JS class made the whole lid pulse at the elbow.
 *   - runs-honesty: a refused roster stood as RETRIEVING… forever.
 *
 * Run: npm run smoke   (needs a live daemon; ARGUS_URL overrides discovery)
 */
import { argusUrl_discover, page_open } from './driver.mjs';

const failures = [];
let passes = 0;

function check(name, condition, detail = '') {
  if (condition) { passes += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const page = await page_open(argusUrl_discover());
const evalIn = (body) => page.eval(`(async () => { const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); ${body} })()`);

try {
  console.log('boot');
  const ready = await evalIn(`
    for (let i=0;i<120;i++){ await sleep(500);
      const m=document.getElementById('drawer-status');
      if (m && m.textContent.includes('READY')) return true; }
    return false;`);
  check('session reaches READY', ready === true);
  if (!ready) throw new Error('no session');

  console.log('drawer-everywhere (files, runs, pacs)');
  for (const preset of ['gutter-files', 'gutter-runs', 'gutter-tools']) {
    const result = await evalIn(`
      document.getElementById('${preset}').click(); await sleep(700);
      const leaves = [...document.querySelectorAll('#layout-root .layout-leaf > *')];
      const bad = leaves.filter((m) => !m.querySelector('.pane-handle') || !m.querySelector('.pane-drawer'));
      const first = leaves[0];
      let opened = false;
      if (first) {
        const drawer = first.querySelector('.pane-drawer');
        first.querySelector('.pane-handle').click(); await sleep(150);
        opened = drawer && !drawer.hidden;
        if (opened) { first.querySelector('.pane-handle').click(); await sleep(100); }
      }
      return { leaves: leaves.length, bad: bad.map((b) => b.id || b.className), opened };`);
    check(`${preset}: every shown pane carries handle+drawer`, result.bad.length === 0 && result.leaves > 0, JSON.stringify(result.bad));
    check(`${preset}: drawer opens from the handle`, result.opened === true);
  }

  console.log('zoom-completeness');
  const zoom = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(700);
    const pane = document.querySelector('.pane-files');
    pane.querySelector('.pane-handle').click(); await sleep(150);
    pane.querySelector('.drawer-zoom').click(); await sleep(700);
    const header = document.querySelector('.wrap:not(#gap)');
    const gutter = document.querySelector('.left-frame');
    const zoomed = {
      headerBottom: header.getBoundingClientRect().bottom,
      gutterRight: gutter.getBoundingClientRect().right,
    };
    // Contextual back is a stack: the open pane drawer takes the first
    // Esc, the zoom the next.
    for (let i = 0; i < 3 && header.getBoundingClientRect().bottom <= 1; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(700);
    }
    zoomed.restoredHeaderBottom = header.getBoundingClientRect().bottom;
    return zoomed;`);
  check('zoom slides the whole header off stage', zoom.headerBottom <= 1, `bottom=${zoom.headerBottom}`);
  check('zoom slides the gutter off stage', zoom.gutterRight <= 1, `right=${zoom.gutterRight}`);
  check('Esc restores the header', zoom.restoredHeaderBottom > 50, `bottom=${zoom.restoredHeaderBottom}`);

  console.log('lid-parity + single-beckon-author');
  const lid = await evalIn(`
    const bar = document.getElementById('drawer-toggle');
    const segs = () => [...bar.querySelectorAll('div')].map((d) => { const r = d.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
    const anims = () => [getComputedStyle(bar).animationName,
      ...[...bar.querySelectorAll('div:not(.bar-10)')].map((d) => getComputedStyle(d).animationName)];
    const drawer = document.getElementById('drawer');
    const wasClosed = drawer.classList.contains('drawer-closed');
    if (wasClosed) { bar.click(); await sleep(600); }
    const open = segs();
    bar.click(); await sleep(600);
    const closed = segs();
    const closedAnims = anims();
    const capAnim = getComputedStyle(bar.querySelector('.bar-10')).animationName;
    bar.click(); await sleep(300);
    if (wasClosed) { bar.click(); await sleep(300); }
    return { open, closed, closedAnims, capAnim };`);
  check('lid segments identical open and closed', JSON.stringify(lid.open) === JSON.stringify(lid.closed));
  check('closed lid: bar and segments carry no animation', lid.closedAnims.every((a) => a === 'none'), JSON.stringify(lid.closedAnims));
  check('closed lid: the end block beckons', lid.capAnim !== 'none', lid.capAnim);

  console.log('lang-toggle');
  const lang = await evalIn(`
    const pill = document.getElementById('lang-pill');
    const palette = document.getElementById('lang-palette');
    pill.click(); await sleep(150);
    const a = { open: !palette.hidden, lit: pill.classList.contains('lang-live') };
    pill.click(); await sleep(150);
    const b = { open: !palette.hidden, lit: pill.classList.contains('lang-live') };
    return { a, b };`);
  check('LANG opens the line and lights the given', lang.a.open && lang.a.lit);
  check('LANG again removes the line and dims the given', !lang.b.open && !lang.b.lit);

  console.log('runs-honesty');
  const runs = await evalIn(`
    document.getElementById('gutter-runs').click();
    for (let i=0;i<60;i++){ await sleep(500);
      if (document.querySelector('.feedlist-row')) return 'roster';
      if (document.querySelector('.feedlist-refusal') || document.querySelector('.feedlist-warming')) return 'refusal';
      }
    return document.querySelector('.feedlist-loading') ? 'loading' : 'silent-empty';`);
  check('RUNS-02 answers with roster, refusal, or visible wait', runs !== 'silent-empty', runs);

  console.log('nameplate');
  const seal = await evalIn(`
    const mark = document.querySelector('.brand-mark');
    if (!mark) return { present: false };
    const style = getComputedStyle(mark);
    const r = mark.getBoundingClientRect();
    return { present: true, masked: style.maskImage.includes('url'), visible: r.width > 20 && r.height > 10 };`);
  check('the nameplate seal is present, masked, and visible', seal.present && seal.masked && seal.visible);
} finally {
  page.close();
}

console.log(`\n${passes} ok, ${failures.length} failed${failures.length ? `: ${failures.join('; ')}` : ''}`);
process.exit(failures.length === 0 ? 0 : 1);
