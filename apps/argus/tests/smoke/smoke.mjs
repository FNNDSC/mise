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
 *
 * The image scenarios need a DICOM series and a NIfTI on the daemon's CFS.
 * Name them with SMOKE_DICOM_SERIES and SMOKE_NIFTI, or let the suite
 * synthesize its own (tests/smoke/fixtures/synth.mjs), put them under the
 * identity's uploads through /vfs, and remove them at the end;
 * SMOKE_NO_FIXTURES=1 skips that and the scenarios say why they skipped.
 *
 * The whole suite drives a real browser against a live daemon — about three
 * minutes for twenty-seven scenarios — so while building one thing,
 * `SMOKE_ONLY=pacs-listing npm run smoke` runs just that one (about thirty
 * seconds) and `SMOKE_SKIP=` leaves scenarios out. Neither is set in CI or
 * before a merge, where the whole suite is the point.
 */
import { argusUrl_discover, page_open } from './driver.mjs';

const failures = [];
let passes = 0;

function check(name, condition, detail = '') {
  if (condition) { passes += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/**
 * Scenario gating and timing.
 *
 * The whole suite drives a real browser against a live daemon, which is
 * minutes, not seconds — so a scenario nobody is working on is time spent
 * proving something already proven. `SMOKE_ONLY` runs just the named
 * scenarios (comma-separated, matched as substrings) and `SMOKE_SKIP`
 * leaves them out; neither is set in CI or in a release check, where the
 * whole suite is the point.
 *
 * Each scenario reports its own wall time, so the expensive ones are
 * visible rather than merely felt.
 */
const only = (process.env.SMOKE_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const skip = (process.env.SMOKE_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const timings = [];
let stageName = null;
let stageAt = 0;

function stage_close() {
  if (stageName === null) return;
  timings.push([stageName, Date.now() - stageAt]);
  stageName = null;
}

/**
 * Announces a scenario and says whether to run it.
 *
 * @param {string} name - The scenario's name.
 * @returns {boolean} True when this run includes it.
 */
function stage(name) {
  stage_close();
  const wanted = (only.length === 0 || only.some((s) => name.includes(s)))
    && !skip.some((s) => name.includes(s));
  if (!wanted) return false;
  console.log(name);
  stageName = name;
  stageAt = Date.now();
  return true;
}

const page = await page_open(argusUrl_discover());
// `settled` waits for a measured value to stop changing, so a scenario can
// follow a CSS glide without guessing at its duration: a fixed sleep either
// samples mid-flight or, when a click has yet to register, before it starts.
const evalIn = (body) => page.eval(`(async () => {
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const settled = async (read, { quiet = 3, step = 60, limit = 3000 } = {}) => {
    let last = NaN; let still = 0;
    for (let waited = 0; waited < limit; waited += step) {
      await sleep(step);
      const now = read();
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= quiet) return now;
    }
    return last;
  };
  // A scenario that speaks to the session starts from a settled console: no
  // question left open by an earlier scenario (Esc abandons it — the ask
  // owns Esc, so nothing else moves), and the session not BUSY with a command
  // an earlier scenario issued. A command typed into an open question is an
  // answer, and one queued behind a slow command times out looking idle.
  const console_idle = async ({ limit = 30000 } = {}) => {
    const glyph = () => document.querySelector('.argus-input-glyph')?.textContent ?? '❯';
    for (let i = 0; i < 3 && glyph() !== '❯'; i++) {
      document.querySelector('#terminal input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);
    }
    const status = () => document.getElementById('drawer-status')?.textContent ?? '';
    for (let waited = 0; waited < limit; waited += 250) {
      if (/READY/.test(status()) && glyph() === '❯') return true;
      await sleep(250);
    }
    return false;
  };
  ${body}
})()`);

try {
  console.log('boot');
  const ready = await evalIn(`
    for (let i=0;i<120;i++){ await sleep(500);
      const m=document.getElementById('drawer-status');
      if (m && m.textContent.includes('READY')) return true; }
    return false;`);
  check('session reaches READY', ready === true);
  if (!ready) throw new Error('no session');

  if (stage('drawer-everywhere (files, runs, pacs)')) {
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
  }

  if (stage('gutter-idempotency')) {
  const pacsTwice = await evalIn(`
    document.getElementById('gutter-tools').click(); await sleep(500);
    document.getElementById('gutter-tools').click(); await sleep(500);
    const pacs = document.getElementById('pacs-workspace');
    return { shown: pacs.getBoundingClientRect().height > 100 };`);
  check('PACS-03 always renders PACS (a given never toggles)', pacsTwice.shown === true);
  const consoleGiven = await evalIn(`
    const drawerEl = document.getElementById('drawer');
    if (!drawerEl.classList.contains('drawer-closed')) {
      document.getElementById('drawer-toggle').click(); await sleep(500);
    }
    document.getElementById('gutter-console').click(); await sleep(500);
    const first = !drawerEl.classList.contains('drawer-closed');
    document.getElementById('gutter-console').click(); await sleep(500);
    const second = !drawerEl.classList.contains('drawer-closed');
    return { first, second };`);
  check('CONSOLE-05 always renders the console open (never toggles)', consoleGiven.first && consoleGiven.second);
  }

  if (stage('zoom-completeness')) {
  const zoom = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(700);
    const pane = document.querySelector('.pane-files');
    pane.querySelector('.pane-handle').click(); await sleep(150);
    pane.querySelector('.drawer-zoom').click();
    const header = document.querySelector('.wrap:not(#gap)');
    // The header glides; a fixed wait either catches it mid-flight or, if
    // the click has not registered yet, before it starts. Wait for the
    // motion to stop instead of guessing how long it takes.
    await settled(() => header.getBoundingClientRect().bottom);
    const gutter = document.querySelector('.left-frame');
    const lid = document.getElementById('drawer-toggle');
    const status = document.getElementById('status-strip');
    const strip = document.getElementById('header-restore');
    const zoomed = {
      headerBottom: header.getBoundingClientRect().bottom,
      gutterRight: gutter.getBoundingClientRect().right,
      lidHidden: lid.getBoundingClientRect().height === 0,
      statusHidden: status.getBoundingClientRect().height === 0,
      stripShown: strip.getBoundingClientRect().height > 0,
      capsule: (() => { const c = pane.querySelector('.drawer-zoom');
        return c.getBoundingClientRect().height > 0 ? c.textContent : 'HIDDEN'; })(),
    };
    // Every step here is a glide; each waits for its own motion to stop.
    strip.click();
    await settled(() => header.getBoundingClientRect().bottom);
    zoomed.stripRestored = header.getBoundingClientRect().bottom > 50;
    zoomed.capsuleAfter = pane.querySelector('.drawer-zoom').textContent;
    pane.querySelector('.drawer-zoom').click();
    await settled(() => header.getBoundingClientRect().bottom);
    // Contextual back is a stack: the open pane drawer takes the first
    // Esc, the zoom the next.
    for (let i = 0; i < 3 && header.getBoundingClientRect().bottom <= 1; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settled(() => header.getBoundingClientRect().bottom);
    }
    zoomed.restoredHeaderBottom = header.getBoundingClientRect().bottom;
    return zoomed;`);
  check('zoom slides the whole header off stage', zoom.headerBottom <= 1, `bottom=${zoom.headerBottom}`);
  check('zoom slides the gutter off stage', zoom.gutterRight <= 1, `right=${zoom.gutterRight}`);
  check('zoom hides the lid and the status readouts', zoom.lidHidden && zoom.statusHidden);
  check('zoom leaves the thin restore strip, and it restores', zoom.stripShown && zoom.stripRestored);
  check('the capsule reads RESTORE while zoomed, ZOOM after', zoom.capsule === 'RESTORE' && zoom.capsuleAfter === 'ZOOM', `${zoom.capsule}/${zoom.capsuleAfter}`);
  check('Esc restores the header', zoom.restoredHeaderBottom > 50, `bottom=${zoom.restoredHeaderBottom}`);
  }

  if (stage('split-zoom')) {
  const splitZoom = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(600);
    const pane = document.querySelector('.pane-files');
    pane.querySelector('.pane-handle').click(); await sleep(150);
    pane.querySelector('[data-split="col"][data-place="after"]').click(); await sleep(600);
    const leaves = document.querySelectorAll('#layout-root .layout-leaf').length;
    pane.querySelector('.pane-handle').click(); await sleep(150);
    // The leaf grows into the region; wait for that growth to stop rather
    // than sampling it mid-glide.
    pane.querySelector('.drawer-zoom').click();
    const leaf = pane.closest('.layout-leaf');
    await settled(() => Math.round(leaf.getBoundingClientRect().width));
    const r = leaf.getBoundingClientRect();
    const full = r.width > window.innerWidth * 0.85;
    for (let i = 0; i < 3 && document.body.dataset.zoom !== undefined; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settled(() => Math.round(leaf.getBoundingClientRect().width));
    }
    document.getElementById('gutter-files').click(); await sleep(400);
    return { leaves, full, w: Math.round(r.width) };`);
  check('a zoomed leaf inside a split conquers the whole region', splitZoom.leaves >= 2 && splitZoom.full, `leaves=${splitZoom.leaves} w=${splitZoom.w}`);
  }

  if (stage('lid-parity + single-beckon-author')) {
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
  }

  if (stage('lang-toggle')) {
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
  }

  if (stage('runs-honesty')) {
  const runs = await evalIn(`
    document.getElementById('gutter-runs').click();
    for (let i=0;i<60;i++){ await sleep(500);
      if (document.querySelector('.feedlist-row')) return 'roster';
      if (document.querySelector('.feedlist-refusal') || document.querySelector('.feedlist-warming')) return 'refusal';
      }
    return document.querySelector('.feedlist-loading') ? 'loading' : 'silent-empty';`);
  check('RUNS-02 answers with roster, refusal, or visible wait', runs !== 'silent-empty', runs);
  }

  if (stage('console-grammar')) {
  const consoleGrammar = await evalIn(`
    const drawerEl = document.getElementById('drawer');
    if (drawerEl.classList.contains('drawer-closed')) {
      document.getElementById('drawer-toggle').click(); await sleep(500);
    }
    const handle = document.getElementById('console-handle');
    const cdrawer = document.getElementById('console-drawer');
    handle.click(); await sleep(150);
    const out = { opened: !cdrawer.hidden };
    const capsule = cdrawer.querySelector('.drawer-zoom');
    out.capsuleShown = capsule.getBoundingClientRect().height > 0;
    capsule.click(); await sleep(600);
    out.zoomed = document.body.dataset.zoom === 'console';
    out.reads = capsule.textContent;
    capsule.click(); await sleep(600);
    out.restored = document.body.dataset.zoom === undefined;
    out.readsAfter = capsule.textContent;
    cdrawer.querySelector('.console-retract').click(); await sleep(500);
    out.retracted = drawerEl.classList.contains('drawer-closed');
    document.getElementById('drawer-toggle').click(); await sleep(300);
    return out;`);
  check('console drawer opens from its handle', consoleGrammar.opened && consoleGrammar.capsuleShown);
  check('console drawer zooms the console and reads RESTORE', consoleGrammar.zoomed && consoleGrammar.reads === 'RESTORE');
  check('console zoom restores and reads ZOOM', consoleGrammar.restored && consoleGrammar.readsAfter === 'ZOOM');
  check('console drawer CLOSE retracts the console', consoleGrammar.retracted === true);
  }

  if (stage('console-height')) {
  // The operator divides the stage, not a constant. A workspace floor is a
  // console ceiling: the drawer can only grow into space the workspace will
  // give up, so a `min-height` on main silently capped the console at
  // roughly half the frame however far the strip was dragged.
  const consoleHeight = await evalIn(`
    const out = {};
    const drawerEl = document.getElementById('drawer');
    if (drawerEl.classList.contains('drawer-closed')) {
      document.getElementById('drawer-toggle').click(); await sleep(400);
    }
    out.workspaceFloor = getComputedStyle(document.querySelector('main')).minHeight;

    // Drive the strip the way a hand does: press, travel, release.
    const strip = document.getElementById('drawer-strip');
    out.stripFound = !!strip;
    if (strip) {
      const start = drawerEl.getBoundingClientRect().height;
      strip.dispatchEvent(new MouseEvent('mousedown', { clientY: 0, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: window.innerHeight, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await sleep(200);
      out.start = start;
      out.grown = drawerEl.getBoundingClientRect().height;
      out.viewport = window.innerHeight;
      // Put the stage back: a console left at full height leaves no
      // workspace for the checks that follow.
      drawerEl.style.height = '';
      await sleep(200);
      out.restoredHeight = drawerEl.getBoundingClientRect().height;
    }
    return out;`);
  if (consoleHeight.stripFound) {
    // The old ceiling was the viewport less the 20rem floor and the chrome
    // above it; comfortably over half the viewport proves the floor is gone.
    const past = consoleHeight.grown > consoleHeight.viewport * 0.6;
    check('the console drags past the old workspace floor', past,
      JSON.stringify({ start: consoleHeight.start, grown: consoleHeight.grown, viewport: consoleHeight.viewport }));
    check('and the workspace keeps no floor of its own', consoleHeight.workspaceFloor === '0px', consoleHeight.workspaceFloor);
    check('and the console returns to its resting height', consoleHeight.restoredHeight < consoleHeight.grown,
      JSON.stringify({ grown: consoleHeight.grown, restored: consoleHeight.restoredHeight }));
  }
  }

  if (stage('warmup-failure')) {
  // A warm-up moved off the boot gate has no readout left to be printed
  // to, so it is named on the JOBS readout and stays there until a later
  // attempt clears it. Driven through the surface's own prompt-context
  // path, so this exercises the rendering an operator actually sees.
  const warmFail = await evalIn(`
    const jobs = document.getElementById('status-jobs');
    const base = globalThis.__argusPromptContext;
    const show = globalThis.__argusPromptContext_show;
    if (!jobs || !base || !show) return { ready: false };

    // The readout is written synchronously, and each reading is taken in the
    // same turn as the show that caused it: the daemon pushes a live
    // promptline every second while the index moves, and any await between
    // a show and its reading is a gap that push can land in, replacing the
    // injected context with a real one that carries no failure.
    show({ ...base, warmupFailures: [{ label: 'Groups', message: 'membership service unavailable' }] });
    const named = jobs.textContent.includes('WARM-UP FAILED') && jobs.textContent.includes('GROUPS');
    const degraded = jobs.classList.contains('status-degraded');
    const explained = jobs.title.includes('membership service unavailable');

    // It persists: another context carrying the same failure must not clear it.
    show({ ...base, warmupFailures: [{ label: 'Groups', message: 'membership service unavailable' }] });
    const persists = jobs.textContent.includes('WARM-UP FAILED');

    // And a later success clears it.
    show({ ...base });
    const cleared = !jobs.textContent.includes('WARM-UP FAILED') && !jobs.classList.contains('status-degraded');

    return { ready: true, named, degraded, explained, persists, cleared };`);
  if (warmFail.ready) {
    check('a failed deferred warm-up is named on the status readout and persists',
      warmFail.named && warmFail.degraded && warmFail.persists && warmFail.cleared,
      JSON.stringify(warmFail));
    check('and the readout explains it', warmFail.explained, JSON.stringify(warmFail));
  } else {
    check('a failed deferred warm-up is named on the status readout and persists', false,
      'the surface exposed no prompt-context seam');
  }
  }

  if (stage('focus-citizenship')) {
  const focusCit = await evalIn(`
    const prefix = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
    const cdrawer = document.getElementById('console-drawer');
    const drawerEl = document.getElementById('drawer');
    if (drawerEl.classList.contains('drawer-closed')) { document.getElementById('drawer-toggle').click(); await sleep(400); }
    // touch the workspace, prefix must address the pane
    document.getElementById('gutter-files').click(); await sleep(500);
    const fpane = document.querySelector('.pane-files');
    fpane.querySelector('.files-panel').click(); await sleep(150);
    prefix(); await sleep(200);
    const fdrawer = fpane.querySelector('.pane-drawer');
    const paneGot = !fdrawer.hidden && cdrawer.hidden;
    if (!fdrawer.hidden) { prefix(); await sleep(200); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(200); }
    // touch the console, prefix must address the console
    document.getElementById('terminal').click(); await sleep(150);
    prefix(); await sleep(200);
    const consoleGot = !cdrawer.hidden;
    if (!cdrawer.hidden) cdrawer.hidden = true;
    // the given focuses its channel too
    document.getElementById('gutter-console').click(); await sleep(300);
    prefix(); await sleep(200);
    const givenGot = !cdrawer.hidden;
    if (!cdrawer.hidden) cdrawer.hidden = true;
    return { paneGot, consoleGot, givenGot };`);
  check('focus citizenship: a touched pane owns the prefix', focusCit.paneGot === true);
  check('focus citizenship: the touched console owns the prefix', focusCit.consoleGot === true);
  check('focus citizenship: CONSOLE-05 hands the prefix to the console', focusCit.givenGot === true);
  }

  if (stage('census-pill')) {
  const censusPill = await evalIn(`
    document.getElementById('gutter-runs').click(); await sleep(500);
    const pill = document.querySelector('.dag-census');
    if (!pill) return { present: false };
    const before = pill.textContent;
    pill.click(); await sleep(300);
    const after = pill.textContent;
    pill.click(); await sleep(300);
    const g = document.querySelector('.dag-gravity');
    const gBefore = g ? g.textContent : null;
    if (g) { g.click(); await sleep(300); }
    const gAfter = g ? g.textContent : null;
    if (g) { g.click(); await sleep(300); }
    // HUE is a mode: STATUS by default, COMPUTE colors by resource with a
    // legend on the bar, and the block reads its state either way.
    const h = document.querySelector('.dag-hue');
    const hBefore = h ? h.textContent : null;
    if (h) { h.click(); await sleep(400); }
    const hAfter = h ? h.textContent : null;
    const dp = h ? h.closest('.pane-dag') : null;
    const legend = dp ? dp.querySelector('.pane-mode .pane-legend') !== null : false;
    if (h) { h.click(); await sleep(300); }
    return { present: true, before, after, restored: pill.textContent === before, gBefore, gAfter, gRestored: g ? g.textContent === gBefore : false, hBefore, hAfter, legend, hRestored: h ? h.textContent === hBefore : false };`);
  check('CENSUS pill present, toggles SHAPE/CENSUS, restores', censusPill.present && censusPill.before === 'SHAPE' && censusPill.after === 'CENSUS' && censusPill.restored);
  check('GRAVITY pill reads its state and toggles', censusPill.gBefore === 'GRAVITY OFF' && censusPill.gAfter === 'GRAVITY ON' && censusPill.gRestored);
  check('the HUE block reads STATUS, COMPUTE puts the legend on the bar, and it restores', censusPill.hBefore === 'STATUS' && censusPill.hAfter === 'COMPUTE' && censusPill.legend && censusPill.hRestored, JSON.stringify({ b: censusPill.hBefore, a: censusPill.hAfter, l: censusPill.legend }));
  }

  if (stage('mode-frame')) {
  // The field carries content only: at rest the mode frame is a strip at
  // the field's edge and no control stands in the field; touching the
  // strip slides the frame in (its pills work there); touching the field
  // retracts it; so does Esc. The header's retraction grammar, pane scale.
  const modeFrame = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    for (let i = 0; i < 40; i++) { await sleep(300); if (fp.querySelectorAll('.files-row').length > 1) break; }
    const body = fp.querySelector('.files-body');
    const strip = fp.querySelector('.mode-strip');
    const frame = fp.querySelector('.mode-frame');
    const bodyRect = body.getBoundingClientRect();
    // Column caps are the table's own frame (caps-are-the-sort), not chrome over the field.
    const inField = [...body.querySelectorAll('button')].filter(b => !b.closest('.mode-frame') && !b.closest('.mode-strip') && ![...b.classList].some(k => k.startsWith('roster-')));
    const rule = fp.querySelector('.field-rule').getBoundingClientRect();
    const elbow = fp.querySelector('.mode-elbow').getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const atRest = {
      stripShown: stripRect.width > 0 && stripRect.height > 40,
      frameOff: getComputedStyle(frame).visibility === 'hidden' && stripRect.width < 12,
      fieldClean: inField.length === 0,
      // the frame is drawn at rest: a rule along the top meeting the spine through an elbow
      ruleDrawn: rule.width > 100 && rule.height >= 4 && Math.abs(rule.right - stripRect.left) <= 1,
      elbowJoins: elbow.width > 20 && Math.abs(elbow.right - stripRect.right) <= 1 && Math.abs(elbow.top - rule.top) <= 1,
      // filtering is a mode: the strip is folded at rest
      filterFolded: fp.querySelector('.roster-filter').getBoundingClientRect().height === 0,
    };
    // The frame slides in; wait for the strip to stop widening.
    strip.click();
    await settled(() => Math.round(strip.getBoundingClientRect().width));
    const barRect = strip.getBoundingClientRect();
    const opened = barRect.width > 80 && frame.getBoundingClientRect().left < bodyRect.right - 40 && getComputedStyle(frame).visibility === 'visible' && fp.dataset.modes === 'open';
    const pill = fp.querySelector('.files-view');
    const pillWorks = (() => { const b = pill.textContent; pill.click(); const c = pill.textContent; return b === 'LIST' && c === 'CARDS'; })();
    await sleep(200);
    const modeRead = fp.querySelector('.pane-mode').textContent;
    // blocks sit flush against the spine, under the rule
    const frameRect = frame.getBoundingClientRect();
    // the blocks are segments of the widened bar: same width, same right edge, under the elbow
    const blocksFlush = Math.abs(frameRect.right - barRect.right) <= 1 && Math.abs(frameRect.width - barRect.width) <= 1 && frameRect.top >= rule.bottom;
    // FILTER is a block on the frame: it unfolds the strip and reads its state
    const fb = fp.querySelector('.files-filter');
    const filterBefore = fb.textContent;
    fb.click(); await sleep(250);
    const filterOpen = fp.querySelector('.roster-filter').getBoundingClientRect().height > 0 && fb.textContent === 'FILTER ON';
    fb.click(); await sleep(250);
    const filterClosed = fp.querySelector('.roster-filter').getBoundingClientRect().height === 0 && fb.textContent === filterBefore;
    // Retraction is a glide too: the strip narrows back to a sliver.
    fp.querySelector('.files-panel').click();
    await settled(() => Math.round(strip.getBoundingClientRect().width));
    const fieldRetracts = fp.dataset.modes === undefined && getComputedStyle(frame).visibility === 'hidden' && strip.getBoundingClientRect().width < 12;
    strip.click();
    await settled(() => Math.round(strip.getBoundingClientRect().width));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settled(() => Math.round(strip.getBoundingClientRect().width));
    const escRetracts = fp.dataset.modes === undefined;
    // back to LIST for the scenarios that follow
    for (let i = 0; i < 3 && pill.textContent !== 'LIST'; i++) pill.click();
    await sleep(200);
    return { atRest, opened, pillWorks, modeRead, blocksFlush, filterBefore, filterOpen, filterClosed, fieldRetracts, escRetracts, restored: pill.textContent === 'LIST' };`);
  check('the mode frame rests as a strip, and the field carries no control', modeFrame.atRest.stripShown && modeFrame.atRest.frameOff && modeFrame.atRest.fieldClean, JSON.stringify(modeFrame.atRest));
  check('the field is framed at rest: a rule turning through an elbow into the spine', modeFrame.atRest.ruleDrawn && modeFrame.atRest.elbowJoins, JSON.stringify(modeFrame.atRest));
  check('touching the strip slides the mode frame in, and its pills work there', modeFrame.opened && modeFrame.pillWorks && modeFrame.blocksFlush, JSON.stringify({ o: modeFrame.opened, p: modeFrame.pillWorks, f: modeFrame.blocksFlush }));
  check('filtering is a mode: folded at rest, the FILTER block unfolds it and reads its state', modeFrame.atRest.filterFolded && modeFrame.filterBefore === 'FILTER OFF' && modeFrame.filterOpen && modeFrame.filterClosed, JSON.stringify({ r: modeFrame.atRest.filterFolded, b: modeFrame.filterBefore, o: modeFrame.filterOpen, c: modeFrame.filterClosed }));
  check('the bar annunciates the non-default mode', modeFrame.modeRead === 'CARDS', modeFrame.modeRead);
  check('touching the field retracts the mode frame; so does Esc', modeFrame.fieldRetracts && modeFrame.escRetracts && modeFrame.restored, JSON.stringify({ field: modeFrame.fieldRetracts, esc: modeFrame.escRetracts, restored: modeFrame.restored }));
  }

  if (stage('cards')) {
  // CARDS projects the same listing: the pill reads the mode, cards carry
  // the kind as badge, the count equals the rows', and LIST comes back.
  // PREVIEW is the third projection: every card leads with a glimpse.
  const cards = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    for (let i = 0; i < 40; i++) { await sleep(300); if (fp.querySelectorAll('.files-row').length > 1) break; }
    const rows = [...fp.querySelectorAll('.files-row')].filter(r => r.querySelector('.files-name')?.textContent !== '..').length;
    const pill = fp.querySelector('.files-view');
    const before = pill.textContent;
    pill.click(); await sleep(300);
    const after = pill.textContent;
    const cardEls = [...fp.querySelectorAll('.files-card:not(.files-card-up)')];
    const badgesMatch = cardEls.every(c => c.querySelector('.files-card-badge').textContent.toLowerCase() === [...c.classList].find(k => k.startsWith('files-type-')).replace('files-type-', ''));
    pill.click(); await sleep(600);
    const previewLabel = pill.textContent;
    const previewCards = [...fp.querySelectorAll('.files-card:not(.files-card-up)')];
    const thumbs = previewCards.filter(c => c.querySelector('.files-card-thumb')).length;
    const previewRead = fp.querySelector('.pane-mode').textContent;
    pill.click(); await sleep(300);
    const restored = pill.textContent === before && fp.querySelectorAll('.files-row').length > 1;
    return { before, after, rows, cardCount: cardEls.length, badgesMatch, previewLabel, previewCards: previewCards.length, thumbs, previewRead, restored };`);
  check('CARDS projects the same listing', cards.before === 'LIST' && cards.after === 'CARDS' && cards.cardCount === cards.rows && cards.badgesMatch);
  check('PREVIEW leads every card with a glimpse', cards.previewLabel === 'PREVIEW' && cards.previewCards === cards.rows && cards.thumbs === cards.rows && cards.previewRead === 'PREVIEW' && cards.restored, JSON.stringify({ p: cards.previewLabel, n: cards.previewCards, t: cards.thumbs, r: cards.restored }));
  }

  if (stage('bin-context')) {
  // Everything in /bin is a graph: a plugin is the one-node case, drawn on
  // the same stage a pipeline gets, and its node opens as its parameters.
  // The wall of scraped text it used to be is gone.
  const binCtx = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const pill = document.getElementById('lang-pill');
    if (document.getElementById('lang-palette').hidden) { pill.click(); await sleep(150); }
    const li = document.getElementById('lang-input'); li.value = 'ls /bin';
    li.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300);
    pill.click(); await sleep(100);
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    for (let i = 0; i < 60; i++) { await sleep(500); if (fp.querySelector('.files-row.files-type-plugin')) break; }
    const plugin = fp.querySelector('.files-row.files-type-plugin');
    if (!plugin) return { skipped: 'no plugin rows' };
    // A row with verbs is entered by double-click; a single click indicates (a-row-is-indicated-before-it-is-acted-on).
    plugin.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    // Esc is about to be a level test, so the command line — the topmost
    // transient, which takes any Esc while open — closes first. Running a
    // line closes the palette; the pill press above reopened it.
    if (!document.getElementById('lang-palette').hidden) { pill.click(); await sleep(150); }
    let pluginScene = false;
    for (let i = 0; i < 60; i++) { await sleep(500); if (fp.querySelector('.files-diagram canvas')) { pluginScene = true; break; } }
    // No prose: the graph is the whole view.
    const pluginWall = fp.querySelector('.files-content') !== null;
    let pluginSelected = '', pluginImmersed = '', pluginEscLeftNode = false;
    if (pluginScene) {
      await sleep(1200);
      const canvas = fp.querySelector('.files-diagram canvas');
      const facts = () => fp.querySelector('.files-diagram .dag-facts');
      const box = canvas.getBoundingClientRect();
      const at = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
      const hit = (type) => canvas.dispatchEvent(new MouseEvent(type, { ...at, bubbles: true, cancelable: true }));
      hit('click'); await sleep(500);
      pluginSelected = (facts()?.textContent ?? '');
      hit('dblclick'); await sleep(1800);
      pluginImmersed = (facts()?.textContent ?? '');
      // ONE press leaves the node and not the view — the same
      // retreat-exactly-one-level rule the pipeline dive follows.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(1500);
      pluginEscLeftNode = facts()?.classList.contains('dag-facts-immersed') === false
        && fp.querySelector('.files-diagram') !== null;
    }
    // A view is closed by the operator, never by an arrival: a listing
    // asked for while the view is up lands under it, and CLOSE shows it.
    let survivesListing = false, listingUnderneath = false;
    if (pluginScene) {
      const term = document.querySelector('#terminal input');
      term.value = 'ls /usr/bin';
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(2500);
      survivesListing = fp.querySelector('.files-diagram') !== null;
      fp.querySelector('.files-close-pill')?.click(); await sleep(600);
      // A plain includes, not a regex: a slash inside this template
      // literal would be eaten before the page ever parsed it.
      listingUnderneath = [...fp.querySelectorAll('.files-path')]
        .some(el => (el.textContent ?? '').includes('/usr/bin'));
      // Back to /bin for the pipeline half of this scenario.
      term.value = 'ls /bin';
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      for (let i = 0; i < 60; i++) { await sleep(500); if (fp.querySelector('.files-row.files-type-pipeline')) break; }
    }
    // Esc is contextual back: the content view is a level above the listing
    // (the command line, if still open, is the topmost transient and would
    // take the press — close it first).
    if (!document.getElementById('lang-palette').hidden) { pill.click(); await sleep(150); }
    const beforeEsc = fp.querySelector('.files-row.files-type-plugin');
    if (beforeEsc) { beforeEsc.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await sleep(1500); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(600);
    const escBack = !fp.querySelector('.files-diagram') && fp.querySelectorAll('.files-row').length > 0;
    const pipeline = fp.querySelector('.files-row.files-type-pipeline');
    if (!pipeline) return { skipped: null, pluginScene, pluginWall, pluginSelected, pluginImmersed, pluginEscLeftNode, survivesListing, listingUnderneath, escBack, pipelineSkipped: true };
    pipeline.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let summary = false, canvas = false;
    for (let i = 0; i < 60; i++) { await sleep(500); const c = fp.querySelector('.files-content'); if (c && /pipeline/.test(c.textContent)) summary = true; if (fp.querySelector('.files-diagram canvas')) { canvas = true; break; } }
    // The diagram canvas fills its mount in CSS pixels at any device pixel
    // ratio (SMOKE_DPR=1.5 shows the runaway this guards): measured while
    // the view is up, before CLOSE.
    const panelx = fp.querySelector('.files-panel');
    const spills = panelx.scrollWidth > panelx.clientWidth + 1;
    fp.querySelector('.files-close-pill')?.click(); await sleep(300);
    return { skipped: null, pluginScene, pluginWall, pluginSelected, pluginImmersed, pluginEscLeftNode, survivesListing, listingUnderneath, escBack, summary, canvas, pipelineSkipped: false, spills, dpr: window.devicePixelRatio };`);
  if (binCtx.skipped) {
    console.log(`  skipped: ${binCtx.skipped}`);
  } else {
    check('a plugin opens as a graph of one node, with no wall of text',
      binCtx.pluginScene === true && binCtx.pluginWall === false,
      JSON.stringify({ scene: binCtx.pluginScene, wall: binCtx.pluginWall }));
    check('touching the plugin node reads out what it is',
      /PLUGIN/.test(binCtx.pluginSelected ?? '') && /PARAMETERS/.test(binCtx.pluginSelected ?? ''),
      JSON.stringify(binCtx.pluginSelected ?? '').slice(0, 160));
    check('Esc leaves the plugin node, not the view holding it',
      binCtx.pluginEscLeftNode === true, JSON.stringify(binCtx.pluginEscLeftNode));
    check('diving into it opens the node as its parameters',
      /VERSION/.test(binCtx.pluginImmersed ?? '')
      && (/--/.test(binCtx.pluginImmersed ?? '') || /no arguments/.test(binCtx.pluginImmersed ?? '')),
      JSON.stringify(binCtx.pluginImmersed ?? '').slice(0, 200));
    check('a view is closed by the operator, never by an arriving listing',
      binCtx.survivesListing === true && binCtx.listingUnderneath === true,
      JSON.stringify({ survived: binCtx.survivesListing, under: binCtx.listingUnderneath }));
    check('Esc returns a content view to its listing', binCtx.escBack === true);
    if (binCtx.pipelineSkipped) console.log('  skipped: no pipeline rows');
    else {
      check('a pipeline opens as its summary with its DAG rendered', binCtx.summary && binCtx.canvas);
      check('the content view never spills sideways (a scene canvas fills its mount at any pixel ratio)', binCtx.spills === false, JSON.stringify({ spills: binCtx.spills, dpr: binCtx.dpr }));
    }
  }
  }

  if (stage('diagram-modes')) {
  // A pane has one mode frame, and its blocks answer to what the field
  // holds. A wave is a verb you press, never something breathing at rest.
  //
  // The frame swap needs only a diagram on stage; the blocks need a scene
  // behind it, and `pipeline diagram` is slow the first time a pipeline is
  // opened. So the two are checked separately rather than making the
  // cheap assertions hostage to a cold command.
  const diagramModes = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = document.querySelector('.pane-files');
    const body = fp.querySelector('.files-body');
    const shown = (sel) => { const el = body.querySelector(sel);
      return el !== null && getComputedStyle(el).display !== 'none'; };
    const input = document.querySelector('#terminal input');
    input.value = 'cd /bin'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i=0;i<60;i++){ await sleep(500); if (fp.querySelectorAll('.files-row').length > 5) break; }
    const listing = { view: shown('.files-view'), pulse: shown('.diagram-pulse') };

    const pipeline = fp.querySelector('.files-row.files-type-pipeline');
    if (!pipeline) return { skipped: 'no pipeline in /bin' };
    pipeline.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    for (let i=0;i<40;i++){ await sleep(250); if (fp.querySelector('.files-diagram')) break; }
    const diagram = { view: shown('.files-view'), pulse: shown('.diagram-pulse'),
      strategy: shown('.diagram-strategy'), projection: shown('.diagram-projection') };

    // The blocks act on a scene, so wait for one before pressing them.
    let scene = false;
    for (let i=0;i<160;i++){ await sleep(500); if (fp.querySelector('.files-diagram canvas')) { scene = true; break; } }
    let node = null;
    let blocks = null;
    if (scene) {
      await sleep(1200);
      // A node's substance is what it will run with, and the model already
      // carries it: a touch reads it out, a dive goes in, Esc comes back.
      const canvas = fp.querySelector('.files-diagram canvas');
      const facts = () => fp.querySelector('.files-diagram .dag-facts');
      const restingEmpty = (facts()?.textContent ?? '') === '';
      const box = canvas.getBoundingClientRect();
      const at = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
      const hit = (type) => canvas.dispatchEvent(new MouseEvent(type, { ...at, bubbles: true, cancelable: true }));
      hit('click'); await sleep(500);
      const selected = (facts()?.textContent ?? '');
      hit('dblclick'); await sleep(1800);
      const immersedText = (facts()?.textContent ?? '');
      const immersedClass = facts()?.classList.contains('dag-facts-immersed') === true;
      // ONE press. Esc retreats exactly one level, so a second would leave
      // the view as well and this asserts it does not have to.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(1500);
      node = { restingEmpty, selected, immersedText, immersedClass,
        afterEsc: facts()?.classList.contains('dag-facts-immersed') === true,
        keptDiagram: fp.querySelector('.files-diagram') !== null };

      const pulseEl = body.querySelector('.diagram-pulse');
      const restingBefore = pulseEl.classList.contains('pulse-running');
      pulseEl.click(); await sleep(300);
      const litOnPress = pulseEl.classList.contains('pulse-running');
      const projEl = body.querySelector('.diagram-projection');
      const projBefore = projEl.textContent.trim();
      projEl.click(); await sleep(400);
      blocks = { restingBefore, litOnPress, projBefore,
        projAfter: projEl.textContent.trim(),
        bar: fp.querySelector('.pane-mode').textContent.trim() };
    }

    fp.querySelector('.files-close-pill')?.click(); await sleep(700);
    const restored = { view: shown('.files-view'), pulse: shown('.diagram-pulse'),
      bar: fp.querySelector('.pane-mode').textContent.trim() };
    return { listing, diagram, scene, node, blocks, restored };`);
  if (diagramModes.skipped) {
    console.log(`  skipped: ${diagramModes.skipped}`);
  } else {
    check('a listing offers its own modes and none of the diagram\'s',
      diagramModes.listing?.view === true && diagramModes.listing?.pulse === false,
      JSON.stringify(diagramModes.listing));
    check('a diagram on stage swaps the frame to the modes a graph has',
      diagramModes.diagram?.pulse === true && diagramModes.diagram?.strategy === true
      && diagramModes.diagram?.projection === true && diagramModes.diagram?.view === false,
      JSON.stringify(diagramModes.diagram));
    check('closing the diagram gives the frame back to the listing, and clears the bar',
      diagramModes.restored?.view === true && diagramModes.restored?.pulse === false
      && diagramModes.restored?.bar === '',
      JSON.stringify(diagramModes.restored));
    if (!diagramModes.scene) {
      console.log('  skipped: the diagram did not render in time, so its blocks were not pressed');
    } else {
      check('PULSE is a verb: at rest until pressed, never breathing on its own',
        diagramModes.blocks?.restingBefore === false && diagramModes.blocks?.litOnPress === true,
        JSON.stringify(diagramModes.blocks));
      check('a diagram mode reads its state and the bar annunciates the non-default',
        diagramModes.blocks?.projBefore === '3D' && diagramModes.blocks?.projAfter === '2D'
        && /2D/.test(diagramModes.blocks?.bar ?? ''),
        JSON.stringify(diagramModes.blocks));
      check('a graph at rest says nothing until a node is touched',
        diagramModes.node?.restingEmpty === true, JSON.stringify(diagramModes.node?.restingEmpty));
      check('touching a node reads out what it will run',
        /PLUGIN/.test(diagramModes.node?.selected ?? '') && /ARGUMENTS/.test(diagramModes.node?.selected ?? ''),
        JSON.stringify(diagramModes.node?.selected ?? '').slice(0, 160));
      check('diving in opens the node as its parameters, and Esc leaves the node not the view',
        diagramModes.node?.immersedClass === true && /PLUGIN/.test(diagramModes.node?.immersedText ?? '')
        && diagramModes.node?.afterEsc === false && diagramModes.node?.keptDiagram === true,
        JSON.stringify({ immersed: diagramModes.node?.immersedClass, afterEsc: diagramModes.node?.afterEsc,
          kept: diagramModes.node?.keptDiagram }));
    }
  }
  }

  if (stage('follow-declared')) {
  // The following browser says so on its bar, and the binding is a verb
  // both ways: ROOT HERE drops CWD from the bar, FOLLOW CWD brings it back.
  const follow = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const state = () => fp.querySelector('.pane-state').textContent;
    const atLogin = state();
    const verb = async (label) => { fp.querySelector('.pane-handle').click(); await sleep(150); const cap = [...fp.querySelectorAll('.drawer-cwdbind')].find(c => c.textContent === label); if (!cap) return false; cap.click(); await sleep(400); return true; };
    const rooted = await verb('ROOT HERE'); const afterRoot = state();
    const followed = await verb('FOLLOW CWD'); await sleep(1500); const afterFollow = state();
    return { atLogin, rooted, afterRoot, followed, afterFollow };`);
  check('the following browser says CWD on its bar', /^CWD\b/.test(follow.atLogin));
  check('ROOT HERE and FOLLOW CWD re-bind the browser, and the bar follows', follow.rooted && !/^CWD\b/.test(follow.afterRoot) && follow.followed && /^CWD\b/.test(follow.afterFollow));
  }

  if (stage('control-homes')) {
  // A control lives where it acts: the drawer acts on the pane, the frame on
  // the field, the row on the row. Each verb is found in its new home, and
  // the browser's drawer is down to two groups.
  const homes = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const frame = fp.querySelector('.mode-frame');
    const onFrame = [...frame.querySelectorAll('.strategy-pill')].map(p => p.textContent.trim());
    fp.querySelector('.pane-handle').click(); await sleep(200);
    const drawer = fp.querySelector('.pane-drawer');
    const groups = [...drawer.querySelectorAll('.drawer-group')].filter(g => g.offsetParent !== null).length;
    const inDrawer = [...drawer.querySelectorAll('button')].map(b => b.textContent.trim());
    const bindsCwd = [...drawer.querySelectorAll('.drawer-cwdbind')].map(b => b.textContent.trim());
    const selected = drawer.querySelector('.drawer-cwdbind.drawer-bind-selected')?.textContent.trim() ?? '';
    fp.querySelector('.pane-handle').click(); await sleep(150);
    return { onFrame, groups, inDrawer, bindsCwd, selected };`);
  check('HOME and BACK live on the frame that answers to the field',
    homes.onFrame.includes('HOME') && homes.onFrame.includes('BACK'));
  check('FOLLOW CWD and ROOT HERE ride the binding group',
    homes.bindsCwd.join(',') === 'FOLLOW CWD,ROOT HERE');
  check('the binding pair reads the browser it states', homes.selected === 'FOLLOW CWD');
  check("a browser's drawer has two groups", homes.groups === 2);
  check('the row verbs left the drawer',
    !homes.inDrawer.includes('DOWNLOAD') && !homes.inDrawer.includes('DELETE')
    && !homes.inDrawer.includes('HOME') && !homes.inDrawer.includes('BACK'));

  // Moving a control must not cost what it did: a rooted browser still walks
  // its own history — HOME lands home, a folder descends, BACK returns.
  const walk = await evalIn(`
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const names = () => [...fp.querySelectorAll('.files-row .files-name')].map(n => n.textContent.trim());
    const settle = async (want) => { for (let i = 0; i < 40; i++) { await sleep(250); if (want()) return true; } return false; };
    const bind = async (follow) => { fp.querySelector('.pane-handle').click(); await sleep(150);
      fp.querySelector('.drawer-cwdbind[data-follow="' + (follow ? 'on' : 'off') + '"]').click();
      await sleep(200); fp.querySelector('.pane-handle').click(); await sleep(150); };
    await bind(false);
    // Settle on a CHANGE, never on a count: the pane already holds a listing
    // when HOME is pressed, so "more than one row" is true before the answer
    // arrives and the walk then measures the previous place.
    const before = names().join(',');
    const bar = () => fp.querySelector('.pane-state')?.textContent ?? '';
    fp.querySelector('.files-home').click();
    await settle(() => names().length > 1 && names().join(',') !== before);
    // A listing served from the cache says STALE on the bar until the
    // session's refresh replaces it in place. Snapshot the FRESH home, or
    // BACK's fresh listing is compared with a picture the surface itself
    // had already corrected.
    await settle(() => !/STALE/.test(bar()));
    const homeBar = bar();
    const home = names();
    const folder = [...fp.querySelectorAll('.files-row.files-type-dir')].find(r => r.querySelector('.files-name')?.textContent.trim() !== '..');
    const into = folder?.querySelector('.files-name')?.textContent.trim() ?? '';
    // A click indicates and a double-click activates, since this listing
    // carries row verbs (a-row-is-indicated-before-it-is-acted-on).
    folder?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle(() => names().join(',') !== home.join(','));
    const inside = names();
    fp.querySelector('.files-back').click();
    await settle(() => names().join(',') === home.join(','));
    const back = names();
    const backBar = bar();
    await bind(true);
    return { home, into, inside, back, homeBar, backBar };`);
  // The console language reaches each verb where it now lives, which is the
  // point of moving them through a host capability rather than a capsule.
  const spoken = await evalIn(`
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const term = document.querySelector('#terminal input');
    const say = async (line) => { term.value = line;
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(600); };
    const bound = () => fp.querySelector('.drawer-cwdbind.drawer-bind-selected')?.textContent.trim() ?? '';
    await say('file root'); const rooted = bound();
    await say('file follow'); const followed = bound();
    await say('file home'); await sleep(1200);
    const rows = fp.querySelectorAll('.files-row').length;
    return { rooted, followed, rows };`);
  check('the language re-binds a browser where the binding now lives',
    spoken.rooted === 'ROOT HERE' && spoken.followed === 'FOLLOW CWD');
  check('the language still reaches HOME on the frame', spoken.rows > 1);

  check('HOME lands a rooted browser home', walk.home.length > 1 && walk.into !== '');
  check('a folder still descends from the listing', walk.inside.join(',') !== walk.home.join(','));
  // On a miss, say exactly how the second listing of home differed from
  // the first: what it gained, what it lost, and whether only the order
  // moved — three different bugs, and a count cannot tell them apart.
  const homeSet = new Set(walk.home); const backSet = new Set(walk.back);
  const backDiff = {
    home: walk.home.length, into: walk.into, inside: walk.inside.length, back: walk.back.length,
    gained: walk.back.filter((n) => !homeSet.has(n)), lost: walk.home.filter((n) => !backSet.has(n)),
    sameSetOtherOrder: walk.back.length === walk.home.length && walk.back.every((n) => homeSet.has(n)) && walk.back.join(',') !== walk.home.join(','),
    homeBar: walk.homeBar, backBar: walk.backBar,
  };
  check('BACK returns a rooted browser to where it was', walk.back.join(',') === walk.home.join(','), JSON.stringify(backDiff));
  }

  if (stage('row-verbs')) {
  // A row's verbs appear when the row is INDICATED, and indicating is not
  // activating: a click says "this one", a double-click says "go". The
  // track that holds the verbs is reserved on every row, so nothing moves.
  const verbs = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = () => [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const term = document.querySelector('#terminal input');
    const say = async (line, ms) => { term.value = line;
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(ms); };
    const rows = () => [...fp().querySelectorAll('.files-row')];
    const named = (n) => rows().find(r => r.querySelector('.files-name')?.textContent.trim() === n);
    const heading = () => fp().querySelector('.files-path')?.textContent.trim() ?? '';
    const tops = () => rows().map(r => Math.round(r.querySelector('.files-name')?.getBoundingClientRect().top ?? 0));

    await say('cd ~', 1500);
    for (let i = 0; i < 40; i++) { await sleep(300); if (named('feeds')) break; }
    const before = tops();
    const dir = named('feeds');
    dir.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(700);
    const indicated = [...dir.querySelectorAll('.listing-action')].map(b => b.textContent.trim());
    const others = rows().filter(r => r !== dir).every(r => r.querySelectorAll('.listing-action').length === 0);
    const after = tops();
    const stayed = heading();
    dir.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    for (let i = 0; i < 40; i++) { await sleep(300); if (heading() !== stayed) break; }
    const entered = heading();

    // a feed row names the feed it would share, and reads out its grants
    for (let i = 0; i < 40; i++) { await sleep(300); if (rows().some(r => /^feed_\\d+$/.test(r.querySelector('.files-name')?.textContent.trim() ?? ''))) break; }
    const feedRow = rows().find(r => /^feed_\\d+$/.test(r.querySelector('.files-name')?.textContent.trim() ?? ''));
    feedRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    let readout = '';
    for (let i = 0; i < 40; i++) { await sleep(400); readout = feedRow?.querySelector('.listing-readout')?.textContent ?? ''; if (readout) break; }
    const share = [...(feedRow?.querySelectorAll('.listing-action') ?? [])].map(b => b.textContent.trim()).find(l => l.startsWith('SHARE')) ?? '';
    return { before, after, indicated, others, stayed, entered, share, readout };`);
  check('a click indicates rather than activates',
    verbs.stayed === verbs.entered.replace(/\/feeds$/, '') && verbs.indicated.length > 0);
  check('a double-click still enters', /\/feeds$/.test(verbs.entered));
  check('the indicated row shows its verbs and only its row', verbs.others);
  // A row one cell short does not leave a gap: it shifts every cell of every
  // row after it into the wrong column, which is how the action track's own
  // column first landed under a name.
  const grid = await evalIn(`
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const cap = [...fp.querySelectorAll('.roster-cap')].find(c => c.textContent.trim().startsWith('NAME'));
    const rows = [...fp.querySelectorAll('.files-row')];
    const names = rows.map(r => Math.round(r.querySelector('.files-name')?.getBoundingClientRect().left ?? -1));
    return { cap: Math.round(cap?.getBoundingClientRect().left ?? -2), names };`);
  check("every row's name sits under the NAME cap",
    grid.names.length > 1 && grid.names.every((left) => Math.abs(left - grid.cap) <= 8),
    JSON.stringify(grid));

  check('the verbs are the ones the row can be given',
    verbs.indicated.includes('MOVE') && verbs.indicated.includes('COPY') && verbs.indicated.includes('DELETE'));
  check('no row moves when one is indicated', verbs.before.join(',') === verbs.after.join(','));
  check('a feed row names the feed it would share', /^SHARE FEED \d+$/.test(verbs.share));
  check('a grant capsule reads out the access list', /^SHARED WITH /.test(verbs.readout));
  }

  if (stage('place-verbs')) {
  // Two verbs that act on the PLACE: they ride the field's frame, they make
  // and land things in the listing on stage, and the listing shows what
  // they did. Every artefact is removed again at the end.
  const place = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = () => [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const term = document.querySelector('#terminal input');
    const say = async (line, ms) => { term.value = line;
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(ms); };
    const names = () => [...fp().querySelectorAll('.files-row .files-name')].map(n => n.textContent.trim());
    // A cold daemon's first calls to CUBE are slower than a warm one's, and
    // this scenario waits on a real upload: the settle is generous because
    // the alternative is a check that fails for being early.
    const settle = async (want) => { for (let i = 0; i < 140; i++) { await sleep(500); if (want()) return true; } return false; };

    await say('cd ~', 2000);
    await settle(() => names().length > 2);
    const onFrame = [...fp().querySelectorAll('.mode-frame .strategy-pill')].map(p => p.textContent.trim());

    // MKDIR asks for a name and makes it where the field points
    fp().querySelector('.files-mkdir').click();
    let asked = '';
    for (let i = 0; i < 40; i++) { await sleep(300); const a = document.querySelector('#terminal .argus-ask'); if (a) { asked = a.textContent.trim(); break; } }
    term.value = 'smoke-place';
    term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const made = await settle(() => names().includes('smoke-place'));

    // UPLOAD delivers the browser's own bytes into the folder on stage
    await say('cd ~/smoke-place', 2500);
    const chooser = fp().querySelector('.files-upload-input');
    const dt = new DataTransfer();
    dt.items.add(new File([new TextEncoder().encode('smoke\\n')], 'smoke-place.txt', { type: 'text/plain' }));
    chooser.files = dt.files;
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
    const landed = await settle(() => names().includes('smoke-place.txt'));

    await say('cd ~', 2000);
    await say('rm -r ~/smoke-place', 4000);
    // rm reports what it removed; it does not re-list the folder it removed
    // from, so the listing is asked for again the way an operator would.
    await say('ls', 2500);
    const cleared = await settle(() => !names().includes('smoke-place'));
    return { onFrame, asked, made, landed, cleared };`);
  check('MKDIR and UPLOAD ride the frame that answers to the field',
    place.onFrame.includes('MKDIR') && place.onFrame.includes('UPLOAD'));
  check('MKDIR asks for a name, in the place the field holds', /New directory in \//.test(place.asked));
  check('the directory it made is in the listing', place.made);
  check("a file the operator picked lands in the folder on stage", place.landed);
  check('the artefacts are removed again', place.cleared);
  }

  if (stage('roster-shares')) {
  // The roster's rows carry the verbs that act on a FEED: setfacl grants to
  // an identity on a feed, so sharing belongs here. Indicating is not
  // entering, the geometry holds, and both verbs ask before they act.
  const shares = await evalIn(`
    document.getElementById('gutter-runs').click(); await sleep(1000);
    const term = document.querySelector('#terminal input');
    const key = (k) => term.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const rows = () => [...document.querySelectorAll('.feedlist-row')];
    const tops = () => rows().map(r => Math.round(r.querySelector('.feedlist-title')?.getBoundingClientRect().top ?? 0));
    const asks = () => [...document.querySelectorAll('#terminal .argus-ask')];
    const rosterShown = () => document.querySelector('.dag-feedlist')?.offsetParent !== null;
    for (let i = 0; i < 60; i++) { await sleep(400); if (rows().length > 1) break; }

    const before = tops();
    const target = rows()[1];
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    let readout = '';
    for (let i = 0; i < 50; i++) { await sleep(400); readout = target.querySelector('.listing-readout')?.textContent ?? ''; if (readout) break; }
    const verbs = [...target.querySelectorAll('.listing-action')].map(b => b.textContent.trim());
    const others = rows().filter(r => r !== target).every(r => r.querySelectorAll('.listing-action').length === 0);
    const after = tops();
    const stayed = rosterShown();

    // SHARE asks who, and says what cannot be undone before it is answered
    [...target.querySelectorAll('.listing-action')].find(b => b.textContent === 'SHARE')?.click();
    let asked = '';
    for (let i = 0; i < 50; i++) { await sleep(400); const a = asks().pop(); if (a) { asked = a.textContent.trim(); break; } }
    key('Escape'); await sleep(600);

    // DELETE raises the kernel's own confirmation, and NO removes nothing
    const feedsBefore = rows().length;
    [...target.querySelectorAll('.listing-action')].find(b => b.textContent === 'DELETE')?.click();
    let confirm = '';
    for (let i = 0; i < 50; i++) { await sleep(400); const a = asks().pop(); if (a && a.textContent.trim() !== asked) { confirm = a.textContent.trim(); break; } }
    // Escape from the ROW, which is where the hand already is after pressing
    // the row's own verb. Pressed at the console input a question was always
    // abandoned; pressed anywhere else it reached nothing at all.
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(1200);
    const feedsAfter = rows().length;
    // Abandoning a question releases the command that asked it. Bound to the
    // input line alone, Escape pressed with focus on a row reached nothing:
    // the question stayed open and the removal held the lane for as long as
    // the session lived. The lane is where that shows.
    const lane = () => {
      const box = document.getElementById('lane-instrument');
      const row = [...(box?.querySelectorAll('.lane-row') ?? [])]
        .find((r) => r.querySelector('.telemetry-label')?.textContent === 'LANE');
      return row?.querySelector('.telemetry-value')?.textContent ?? '';
    };
    // The lane rides a heartbeat, so give it a few before believing it.
    await sleep(3000);
    const laneAfter = lane();

    // a double-click still enters the feed
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let entered = false;
    for (let i = 0; i < 60; i++) { await sleep(400); if (!rosterShown()) { entered = true; break; } }
    return { verbs, readout, others, moved: before.join(',') !== after.join(','), stayed, asked, confirm, feedsBefore, feedsAfter, laneAfter, entered };`);
  check('a feed row carries the verbs that act on a feed',
    shares.verbs.join(',') === 'SHARE,DELETE' && shares.others);
  check('the row reads back who holds it', /^SHARED WITH /.test(shares.readout));
  check('no roster row moves when one is indicated', !shares.moved);
  check('indicating a feed does not enter it', shares.stayed);
  check('abandoning the confirmation releases the command that asked it',
    !/feed rm/.test(shares.laneAfter ?? ''), `LANE ${shares.laneAfter}`);
  check('SHARE asks who, and says the grant cannot be taken back',
    /with which user/.test(shares.asked) && /cannot be taken back/.test(shares.asked));
  check('DELETE raises the kernel\'s own confirmation', /Remove feed \d+ and everything in it/.test(shares.confirm));
  check('answering no removes nothing', shares.feedsBefore === shares.feedsAfter);
  check('a double-click still enters the feed', shares.entered);

  // Granting for real needs a second identity to grant TO, which not every
  // environment has: set SMOKE_SHARE_USER to run it, and the check says it
  // was skipped rather than passing quietly.
  const shareUser = process.env.SMOKE_SHARE_USER;
  if (shareUser === undefined || shareUser === '') {
    console.log('  skip  a grant reaches the row that made it (set SMOKE_SHARE_USER)');
  } else {
    const granted = await evalIn(`
      document.getElementById('gutter-runs').click(); await sleep(1200);
      const term = document.querySelector('#terminal input');
      const rows = () => [...document.querySelectorAll('.feedlist-row')];
      for (let i = 0; i < 60; i++) { await sleep(400); if (rows().length > 1) break; }
      const target = rows()[1];
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 50; i++) { await sleep(400); if (target.querySelector('.listing-readout')) break; }
      [...target.querySelectorAll('.listing-action')].find(b => b.textContent === 'SHARE')?.click();
      for (let i = 0; i < 50; i++) { await sleep(400); if (document.querySelector('#terminal .argus-ask')) break; }
      term.value = ${JSON.stringify(shareUser)};
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(3000);
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      let readout = '';
      for (let i = 0; i < 50; i++) { await sleep(400); readout = target.querySelector('.listing-readout')?.textContent ?? ''; if (readout.includes(${JSON.stringify(shareUser)})) break; }
      return { readout };`);
    check('a grant reaches the row that made it', granted.readout.includes(shareUser), granted.readout);
  }
  }

  if (stage('select-mode')) {
  // SELECT is a mode: it changes what a click means. The selection is the
  // field's — it survives a filter, it is cleared by navigation — and its
  // verbs are ONE command over many operands.
  const select = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = () => [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null && p.querySelector('.files-select'));
    const term = document.querySelector('#terminal input');
    const say = async (line, ms) => { term.value = line;
      term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(ms); };
    const rows = () => [...fp().querySelectorAll('.files-row')];
    const named = (n) => rows().find(r => r.querySelector('.files-name')?.textContent.trim() === n);
    const bar = () => fp().querySelector('.pane-state')?.textContent.trim() ?? '';
    const verbs = () => [...fp().querySelectorAll('.files-selection-bar .listing-action')].map(b => b.textContent.trim());
    const settle = async (want) => { for (let i = 0; i < 140; i++) { await sleep(500); if (want()) return true; } return false; };

    // A scenario starts from nothing of its own: a folder left by a run that
    // failed part-way would put yesterday's files under today's names.
    await say('rm -r ~/smoke-select', 2500);
    await say('mkdir ~/smoke-select', 2500);
    await say('cd ~/smoke-select', 2500);
    // Two files to gather, put there by the surface's own delivery.
    const chooser = fp().querySelector('.files-upload-input');
    const dt = new DataTransfer();
    dt.items.add(new File([new TextEncoder().encode('one\\n')], 'one.txt', { type: 'text/plain' }));
    dt.items.add(new File([new TextEncoder().encode('two\\n')], 'two.txt', { type: 'text/plain' }));
    chooser.files = dt.files;
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(() => named('one.txt') && named('two.txt'));

    fp().querySelector('.files-select').click(); await sleep(300);
    const modeOn = bar();
    named('one.txt').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(200);
    named('two.txt').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(400);
    const picked = bar();
    const offered = verbs();
    const marked = rows().filter(r => r.classList.contains('listing-selected')).length;

    // a filter hides one: the selection stands, and the bar says how many show
    await say('file filter one', 1800);
    const filtered = bar();
    await say('file filter', 1800);

    // the bulk removal is ONE command that asks ONCE, naming how many
    verbs().find((v) => v.startsWith('DELETE')) && [...fp().querySelectorAll('.files-selection-bar .listing-action')]
      .find(b => b.textContent.startsWith('DELETE')).click();
    let asked = '';
    for (let i = 0; i < 60; i++) { await sleep(400); const a = [...document.querySelectorAll('#terminal .argus-ask')].pop(); if (a) { asked = a.textContent.trim(); break; } }
    const echoed = [...document.querySelectorAll('#terminal .argus-echo')].pop()?.textContent.trim() ?? '';
    // A confirm is answered with the capsule that reads as what it does.
    // The LAST question's capsule: the scrollback keeps every question ever
    // asked, and pressing the first YES presses one already answered.
    [...document.querySelectorAll('#terminal .ask-capsule')].filter(c => c.textContent === 'YES').pop()?.click();
    const removed = await settle(() => !named('one.txt') && !named('two.txt'));

    // navigation clears what was gathered
    await say('cd ~', 2500);
    const afterNav = bar();
    await say('rm -r ~/smoke-select', 3000);
    return { modeOn, picked, offered, marked, filtered, asked, echoed, removed, afterNav };`);
  check('SELECT reads as a mode on the bar', /SELECT/.test(select.modeOn));
  check('a click gathers a row instead of indicating it',
    /2 SELECTED/.test(select.picked) && select.marked === 2);
  check("the selection's verbs count what they would act on",
    select.offered.includes('DELETE 2') && select.offered.includes('MOVE 2') && select.offered.includes('COPY 2'));
  check('a filter hides rows without losing them, and the bar says so',
    /2 SELECTED · 1 SHOWN/.test(select.filtered));
  check('a bulk act is one command the operator could have typed',
    /rm -rI /.test(select.echoed));
  check('and it asks once, naming how many', /remove 2 items/.test(select.asked));
  check('answering yes removes them all', select.removed);
  check('navigation clears the selection', !/SELECTED/.test(select.afterNav));
  }

  if (stage('select-wait')) {
  // Selecting a feed answers at once: the roster steps aside, the pane says
  // what it is retrieving, and the bar reads LOADING until the graph lands.
  const selectWait = await evalIn(`
    document.getElementById('gutter-runs').click();
    for (let i = 0; i < 60; i++) { await sleep(500); if (document.querySelector('.feedlist-row')) break; }
    const dp = document.querySelector('.pane-dag');
    const rows = dp.querySelectorAll('.feedlist-row');
    if (rows.length === 0) return { skipped: 'no roster' };
    // Double-click enters: a roster row carries verbs, so a single click indicates rather than activates.
    rows[rows.length - 1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    // "At once" is the double-click's own turn: the list steps aside, the
    // pane names the feed and the bar reads LOADING before the handler
    // returns. Read there, not after a sleep — a feed whose graph is already
    // resident lands inside any sleep, and LOADING has rightly cleared.
    const atOnce = {
      listHidden: dp.querySelector('.dag-feedlist').style.display === 'none',
      retrieving: /^RETRIEVING FEED \\d+/.test(dp.querySelector('.dag-empty').textContent),
      state: dp.querySelector('.pane-state').textContent,
    };
    for (let i = 0; i < 120; i++) { await sleep(500); if (dp.querySelector('.dag-canvas').style.display === 'block') break; }
    const landed = dp.querySelector('.dag-canvas').style.display === 'block' && dp.querySelector('.dag-empty').style.display === 'none';
    const stateAfter = dp.querySelector('.pane-state').textContent;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    return { skipped: null, atOnce, landed, stateAfter };`);
  if (selectWait.skipped) {
    console.log(`  skipped: ${selectWait.skipped}`);
  } else {
    check('selecting a feed answers at once', selectWait.atOnce.listHidden && selectWait.atOnce.retrieving && selectWait.atOnce.state === 'LOADING', JSON.stringify(selectWait.atOnce));
    check('the graph lands and LOADING clears', selectWait.landed && selectWait.stateAfter !== 'LOADING', JSON.stringify({ landed: selectWait.landed, stateAfter: selectWait.stateAfter }));
  }
  }

  if (stage('pin-survives')) {
  // A pick survives promptlines: with the session cwd parked inside another
  // feed, picking a feed must hold — the follow answers a move, not a
  // promptline. (The regression this guards replaced every pick with the
  // cwd's feed a few seconds later.) The session cwd is put back after.
  const pin = await evalIn(`
    const input = document.querySelector('#terminal input');
    const run = async (line, ms) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(ms); };
    await run('cd /proc/jobs/feed_21', 2000);
    document.getElementById('gutter-runs').click();
    for (let i = 0; i < 60; i++) { await sleep(500); if (document.querySelector('.feedlist-row')) break; }
    const dp = [...document.querySelectorAll('.pane-dag')].find(p => p.offsetParent !== null);
    const rows = [...dp.querySelectorAll('.feedlist-row')].filter(r => r.querySelector('.feedlist-id')?.textContent.trim() !== '21');
    if (rows.length === 0) { await run('cd ~', 1500); return { skipped: 'no other feed' }; }
    // Double-click enters: a roster row carries verbs, so a single click indicates rather than activates.
    rows[rows.length - 1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    for (let i = 0; i < 120; i++) { await sleep(500); if (dp.querySelector('.dag-canvas').style.display === 'block') break; }
    const picked = dp.querySelector('.dag-title').textContent;
    await run('proc feeds', 1500); // a promptline, as any command brings
    await sleep(5000);
    const later = dp.querySelector('.dag-title').textContent;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    await run('cd ~', 1500);
    return { skipped: null, picked, later };`);
  if (pin.skipped) console.log(`  skipped: ${pin.skipped}`);
  else check('a pick survives promptlines while the cwd sits elsewhere', pin.picked === pin.later && !/FEED 21\b/.test(pin.later), `${pin.picked} -> ${pin.later}`);
  }

  if (stage('enter-place')) {
  // ENTER always lands in a place: from the roster pick, ENTER FEED moves the
  // session (and so the cwd-following browser) into /proc/jobs/feed_N.
  const enterPlace = await evalIn(`
    document.getElementById('gutter-runs').click();
    for (let i = 0; i < 60; i++) { await sleep(500); if (document.querySelector('.feedlist-row')) break; }
    const dp = document.querySelector('.pane-dag');
    const rows = dp.querySelectorAll('.feedlist-row');
    if (rows.length === 0) return { skipped: 'no roster' };
    const row = rows[rows.length - 1];
    const feedId = row.querySelector('.feedlist-id') ? row.querySelector('.feedlist-id').textContent.trim() : null;
    row.click();
    for (let i = 0; i < 120; i++) { await sleep(500); if (dp.querySelector('.dag-canvas').style.display === 'block') break; }
    dp.querySelector('.pane-handle').click(); await sleep(150);
    const cap = [...dp.querySelectorAll('.drawer-child')].find(c => c.textContent === 'ENTER FEED');
    if (!cap) return { skipped: null, offered: false };
    cap.click();
    // RUNS-02 owns the whole workspace, so the cwd-following browser is off
    // stage: the session's cwd is read from the console's prompt line.
    let path = null;
    for (let i = 0; i < 40; i++) { await sleep(500); const lines = document.getElementById('terminal').innerText.split('\\n').filter(l => !l.trim().startsWith('❯') && l.includes('/proc/jobs/feed_')); const last = lines[lines.length - 1]; const m = last ? /\\/proc\\/jobs\\/feed_\\d+/.exec(last) : null; if (m) { path = m[0]; break; } }
    if (!dp.querySelector('.pane-drawer').hidden) { dp.querySelector('.pane-handle').click(); await sleep(100); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    // The session is shared with whoever else is attached: put its cwd back.
    const input = document.querySelector('#terminal input'); input.value = 'cd ~';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(1500);
    return { skipped: null, offered: true, feedId, path };`);
  if (enterPlace.skipped) {
    console.log(`  skipped: ${enterPlace.skipped}`);
  } else {
    check('ENTER FEED moves the session into the feed', enterPlace.offered && typeof enterPlace.path === 'string' && enterPlace.path.startsWith('/proc/jobs/feed_'));
  }
  }

  if (stage('live-watch')) {
  // The pane is the subscription: entering a feed opens a watch, the bar
  // reports its liveness, the drawer offers REFRESH, leaving releases it.
  // A daemon older than the watch wire answers `error`; that is reported
  // as a skip, not a pass.
  const live = await evalIn(`
    document.getElementById('gutter-runs').click();
    for (let i = 0; i < 60; i++) { await sleep(500); if (document.querySelector('.feedlist-row')) break; }
    const row = document.querySelector('.feedlist-row');
    if (!row) return { skipped: 'no roster' };
    row.click();
    const dp = document.querySelector('.pane-dag');
    for (let i = 0; i < 60; i++) { await sleep(500); if (dp.querySelector('.dag-canvas').style.display === 'block') break; }
    const state = dp.querySelector('.pane-state');
    let text = '';
    for (let i = 0; i < 20; i++) { await sleep(500); text = state.textContent.trim(); if (text) break; }
    dp.querySelector('.pane-handle').click(); await sleep(150);
    const refreshCap = [...dp.querySelectorAll('.drawer-child')].find(c => c.textContent === 'REFRESH');
    const offered = !!refreshCap;
    if (refreshCap) { refreshCap.click(); await sleep(1500); }
    const after = state.textContent.trim();
    // Esc is contextual back: an open drawer would take the press, so make
    // sure it is closed before asking for the list.
    if (!dp.querySelector('.pane-drawer').hidden) { dp.querySelector('.pane-handle').click(); await sleep(150); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    // Shown, however it lays itself out: the roster is a frame above a
    // scrolling field now, so it shows as flex rather than block.
    const listBack = dp.querySelector('.dag-feedlist').style.display !== 'none';
    const stateCleared = !/^(LIVE|SETTLED|STALE)$/.test(state.textContent.trim());
    return { skipped: text ? null : 'no watched report (daemon predates the watch wire?)', text, offered, after, listBack, stateCleared };`);
  if (live.skipped) {
    console.log(`  skipped: ${live.skipped}`);
  } else {
    check('entering a feed reports its liveness on the bar', /^(LIVE|SETTLED|STALE)$/.test(live.text));
    check('the drawer offers REFRESH and the state survives a refresh', live.offered && /^(LIVE|SETTLED|STALE)$/.test(live.after));
    check('leaving the feed releases the watch: list back, state cleared', live.listBack && live.stateCleared);
  }
  }

  if (stage('roster-order')) {
  const roster = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const pill = document.getElementById('lang-pill');
    if (document.getElementById('lang-palette').hidden) { pill.click(); await sleep(150); }
    const li = document.getElementById('lang-input'); li.value = 'ls /bin';
    li.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300);
    pill.click(); await sleep(100);
    const fp = document.querySelector('.pane-files');
    for (let i = 0; i < 60; i++) { await sleep(500); if (fp.querySelectorAll('.files-row').length > 3) break; }
    const caps = fp.querySelectorAll('.roster-cap').length;
    const names = () => [...fp.querySelectorAll('.files-row .files-name')].map(e => e.textContent).filter(n => n !== '..');
    const before = names().slice(0, 3).join('|');
    fp.querySelector('.roster-cap[data-key="name"]').click(); await sleep(250);
    const after = names().slice(0, 3).join('|');
    const lit = fp.querySelector('.roster-cap.roster-active') !== null;
    fp.querySelector('.files-filter').click(); await sleep(200);
    const strip = fp.querySelector('.roster-filter').getBoundingClientRect().height > 0;
    const input = fp.querySelector('.roster-filter-input');
    input.value = 'zzzz-no-such-entry'; input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(250);
    const state = fp.querySelector('.pane-state').textContent;
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200);
    fp.querySelector('.files-filter').click(); await sleep(100);
    return { caps, sorted: before !== after && before.length > 0, lit, strip, state };`);
  check('column caps sort the files listing (touch to sort, lit when active)', roster.caps >= 4 && roster.sorted && roster.lit, JSON.stringify(roster));
  check('FILTER summons the strip and the bar carries FILTERED n/m', roster.strip && /(^|· )FILTERED 0\//.test(roster.state), roster.state);
  }

  if (stage('pacs-listing')) {
  // A query's answer is the same listing the other two panes are: a frame
  // that sorts and filters, caps minted per study over one column
  // declaration, verbs outside the grid, progress at every level.
  const pacsFrame = await evalIn(`
    document.getElementById('gutter-tools').click(); await sleep(700);
    const ws = document.getElementById('pacs-workspace');
    const frame = ws.querySelector('#pacs-results > .roster-order') !== null;
    const field = ws.querySelector('#pacs-results > .listing-field') !== null;
    const patientCaps = [...ws.querySelectorAll('#pacs-results > .roster-order .roster-cap')].map(c => c.textContent.trim());
    const strip = () => ws.querySelector('#pacs-results .roster-filter').getBoundingClientRect().height;
    const rest = strip();
    ws.querySelector('.pacs-listing .mode-strip').click(); await sleep(350);
    const framed = ws.dataset.modes === 'open';
    const pill = ws.querySelector('.pacs-filter');
    pill.click(); await sleep(250);
    const open = strip() > 0; const onLabel = pill.textContent.trim();
    pill.click(); await sleep(250);
    const shut = strip(); const offLabel = pill.textContent.trim();
    document.getElementById('pacs-results').click(); await sleep(300);
    const retracted = ws.dataset.modes !== 'open';
    return { frame, field, patientCaps, rest, framed, open, onLabel, shut, offLabel, retracted };`);
  check('the PACS results are a framed field: frame outside the scroll, mode frame on the spine',
    pacsFrame.frame === true && pacsFrame.field === true
    && pacsFrame.framed === true && pacsFrame.retracted === true, JSON.stringify(pacsFrame));
  // The MRN level is the outermost one, always: a listing that reports on
  // a set says what happened to every member of it, and only the record of
  // what was ASKED can mention a patient who has no studies.
  check('the patient caps head the region before any answer, ANSWERED among them',
    Array.isArray(pacsFrame.patientCaps) && pacsFrame.patientCaps.includes('PATIENT')
    && pacsFrame.patientCaps.includes('MRN') && pacsFrame.patientCaps.includes('ANSWERED')
    && pacsFrame.patientCaps.includes('STUDIES') && pacsFrame.patientCaps.includes('SERVER'),
    JSON.stringify(pacsFrame.patientCaps));
  check('FILTER summons the results strip and reads its state',
    pacsFrame.rest === 0 && pacsFrame.open === true && pacsFrame.onLabel === 'FILTER ON'
    && pacsFrame.shut === 0 && pacsFrame.offLabel === 'FILTER OFF', JSON.stringify(pacsFrame));

  // The query form stands on the listing's own grid, in the caps' order: a
  // term is typed in the column it will fill.
  const pacsForm = await evalIn(`
    document.getElementById('gutter-tools').click(); await sleep(600);
    const l = (el) => Math.round(el.getBoundingClientRect().left);
    const caps = new Map([...document.querySelectorAll('#pacs-results > .roster-order .roster-cap')]
      .map(c => [c.dataset.key, l(c)]));
    const cells = [...document.querySelectorAll('#pacs-form [data-key]')];
    // The form stands on the STUDY grid, which is where its date, accession
    // and modality terms are answered; its patient terms are answered a
    // level up, and those two columns share the same tracks — so the caps
    // heading the region name them in the same places.
    const off = cells.filter(c => caps.has(c.dataset.key))
      .map(c => [c.dataset.key, l(c) - caps.get(c.dataset.key)]);
    // The two patient terms are answered by the caps heading the region;
    // the rest are answered a level down, where the study caps are minted.
    const patientTerms = off.filter(([key]) => key === 'patient' || key === 'mrn').length;
    // The order the form lowers to is the order the columns read in.
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('pacs-f-name', 'AAA'); set('pacs-f-mrn', '111'); set('pacs-f-date', '20100101');
    set('pacs-f-accession', '222'); set('pacs-f-modality', 'CT');
    await sleep(200);
    const line = document.getElementById('pacs-command').value;
    for (const id of ['pacs-f-name','pacs-f-mrn','pacs-f-date','pacs-f-accession','pacs-f-modality']) set(id, '');
    await sleep(150);
    return { off, line, patientTerms, run: l(document.getElementById('pacs-run')) };`);
  check('the query form stands on the listing grid, in the caps\' order',
    pacsForm.patientTerms === 2
    && pacsForm.off.filter(([key]) => key === 'patient' || key === 'mrn')
      .every(([, delta]) => delta === 0)
    && pacsForm.line === 'pacs query PatientName:AAA,PatientID:111,StudyDate:20100101,AccessionNumber:222,Modality:CT',
    JSON.stringify(pacsForm));

  // Two exports, two scopes. One control did both jobs and sat in the
  // GATHER strip, where every neighbour acts on the cohort — so the one
  // that acted on the whole answer read as if it did not.
  const pacsExports = await evalIn(`
    document.getElementById('gutter-tools').click(); await sleep(600);
    const table = document.getElementById('pacs-export');
    const gather = document.getElementById('pacs-gather-export');
    const frame = document.querySelector('.pacs-listing .mode-frame');
    const strip = document.getElementById('pacs-gather');
    return {
      tableLabel: table ? table.textContent.trim() : null,
      gatherLabel: gather ? gather.textContent.trim() : null,
      tableOnTheField: frame !== null && table !== null && frame.contains(table),
      gatherInTheStrip: strip !== null && gather !== null && strip.contains(gather),
    };`);
  check("the answer's export stands on the field it exports",
    pacsExports.tableLabel === 'EXPORT CSV' && pacsExports.tableOnTheField === true,
    JSON.stringify(pacsExports));
  check("the cohort's export stands with the cohort's verbs and names its scope",
    pacsExports.gatherLabel === 'EXPORT GATHER CSV' && pacsExports.gatherInTheStrip === true,
    JSON.stringify(pacsExports));

  // Demonstrating against a live hospital PACS puts a real name and record
  // number on a projector. ANON arms the kernel's stand-ins and masks every
  // field in the pane that carries what was typed — including the command
  // line, which spells the same values back.
  const pacsAnon = await evalIn(`
    document.getElementById('gutter-tools').click(); await sleep(600);
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const typed = (id) => document.getElementById(id).type;
    set('pacs-f-mrn', '1234567');
    await sleep(150);
    const before = { line: document.getElementById('pacs-command').value, mrn: typed('pacs-f-mrn'), label: document.getElementById('pacs-anon').textContent.trim() };
    document.getElementById('pacs-anon').click(); await sleep(250);
    const armed = {
      line: document.getElementById('pacs-command').value,
      mrn: typed('pacs-f-mrn'), command: typed('pacs-command'), accession: typed('pacs-f-accession'),
      label: document.getElementById('pacs-anon').textContent.trim(),
      revealShown: document.getElementById('pacs-reveal').hidden === false,
      rows: document.querySelectorAll('#pacs-results .listing-row').length,
    };
    document.getElementById('pacs-reveal').click(); await sleep(200);
    const revealed = { mrn: typed('pacs-f-mrn'), command: typed('pacs-command') };
    document.getElementById('pacs-anon').click(); await sleep(250);
    const disarmed = { line: document.getElementById('pacs-command').value, mrn: typed('pacs-f-mrn'), label: document.getElementById('pacs-anon').textContent.trim() };
    set('pacs-f-mrn', '');
    await sleep(150);
    return { before, armed, revealed, disarmed };`);
  check("ANON arms the stand-ins on the line and reads its state",
    pacsAnon.before.label === 'ANON OFF' && pacsAnon.before.line === 'pacs query PatientID:1234567'
    && pacsAnon.armed.label === 'ANON ON' && pacsAnon.armed.line === 'pacs query PatientID:1234567 --anon',
    JSON.stringify(pacsAnon));
  check("ANON masks every field that carries what was typed, the command line included",
    pacsAnon.before.mrn === 'text' && pacsAnon.armed.mrn === 'password'
    && pacsAnon.armed.command === 'password' && pacsAnon.armed.accession === 'password',
    JSON.stringify(pacsAnon));
  check("REVEAL lifts the mask, so a typed record number can be checked before it is asked",
    pacsAnon.armed.revealShown === true && pacsAnon.revealed.mrn === 'text' && pacsAnon.revealed.command === 'text',
    JSON.stringify(pacsAnon));
  check("disarming takes the flag off the line and unmasks",
    pacsAnon.disarmed.label === 'ANON OFF' && pacsAnon.disarmed.line === 'pacs query PatientID:1234567'
    && pacsAnon.disarmed.mrn === 'text',
    JSON.stringify(pacsAnon));

  // Sorting needs an actual answer, so it needs a PACS to answer. Set
  // SMOKE_PACS_QUERY to a query that finds at least one study with two
  // series (e.g. 'pacs query PatientID:12345').
  const pacsQuery = process.env.SMOKE_PACS_QUERY;
  if (!pacsQuery) {
    console.log('  skipped: set SMOKE_PACS_QUERY=<a `pacs query ...` line that finds a study of two or more series>');
  } else {
    const pacsSort = await evalIn(`
      document.getElementById('gutter-tools').click(); await sleep(500);
      const cmd = document.getElementById('pacs-command');
      cmd.value = ${JSON.stringify(pacsQuery)};
      cmd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      for (let i = 0; i < 180; i++) { await sleep(1000);
        if (document.querySelectorAll('#pacs-results .pacs-study').length > 0) break; }
      // A repeat of the same answer can land a moment later; let it, so the
      // fold under test is the operator's and not a race with the wire.
      await sleep(2500);
      const study = () => document.querySelector('#pacs-results .pacs-study');
      if (!study()) return { studies: 0 };
      // A closed group holds no level; activating its row opens it (the
      // façade repaints on the next frame).
      if (!study().classList.contains('listing-open')) {
        study().querySelector('.pacs-study-row').click(); await sleep(400);
      }
      const names = () => [...study().querySelectorAll('.pacs-series .pacs-series-desc')].map(e => e.textContent);
      const before = names().join('|');
      const caps = study().querySelectorAll('.roster-cap').length;
      const track = study().querySelector('.pacs-study-progress .listing-progress') !== null;
      const accession = study().querySelector('.pacs-study-accession')?.textContent ?? '';
      const verbs = study().querySelector('.pacs-series .listing-action') !== null;
      study().querySelector('.roster-cap[data-key="series"]').click(); await sleep(400);
      const ascending = names().join('|');
      const lit = study().querySelector('.roster-cap.roster-active') !== null;
      study().querySelector('.roster-cap[data-key="series"]').click(); await sleep(400);
      const descending = names().join('|');
      return { studies: 1, rows: names().length, before, ascending, descending, caps, track, verbs, lit, accession };`);
    // An answer that was not fetched now says when it was, and the control
    // reads as what it will do next.
    const pacsProvenance = await evalIn(`
      document.getElementById('gutter-tools').click(); await sleep(500);
      const ws = document.getElementById('pacs-workspace');
      const said = () => ws.querySelector('#pacs-provenance');
      const run = () => ws.querySelector('#pacs-run');
      const cmd = () => ws.querySelector('#pacs-command');
      const studies = () => document.querySelectorAll('#pacs-results .pacs-study').length;
      // A previous scenario's answer is still on stage, so waiting for
      // studies to EXIST would sample the old one. Wait for this query to
      // clear the field, then for its own answer to land.
      const answer_await = async () => {
        for (let i = 0; i < 60; i++) { await sleep(100);
          if (document.querySelector('#pacs-results .pacs-waiting')) break; }
        for (let i = 0; i < 240; i++) { await sleep(1000); if (studies() > 0) break; }
        await sleep(2500);
      };
      cmd().value = ${JSON.stringify(pacsQuery)};
      cmd().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await answer_await();
      const shown = !said().hidden;
      const text = said().textContent.trim();
      const label = run().textContent.trim();
      const deeper = run().classList.contains('pacs-capsule-requery');
      // Re-asking must put the flag in the line the operator can read.
      run().click(); await sleep(300);
      const line = cmd().value;
      await answer_await();
      return { shown, text, label, deeper, line, studies: studies(),
        clearedReadout: said().hidden, clearedLabel: run().textContent.trim(),
        clearedLine: cmd().value };`);
    check('a replayed answer says when it was answered, and the control reads RE-QUERY',
      pacsProvenance.shown === true && /^RESULTS \d{4}-\d{2}-\d{2}/.test(pacsProvenance.text)
      && / AGO$/.test(pacsProvenance.text)
      && pacsProvenance.label === 'RE-QUERY' && pacsProvenance.deeper === true,
      JSON.stringify(pacsProvenance));
    check('RE-QUERY lowers to --fresh in the visible line, and a fresh answer clears the readout',
      / --fresh$/.test(pacsProvenance.line) && pacsProvenance.clearedReadout === true
      && pacsProvenance.clearedLabel === 'QUERY'
      && !/--fresh/.test(pacsProvenance.clearedLine),
      JSON.stringify(pacsProvenance));

    check('a study heads its series with caps, a summed track, and verbs',
      pacsSort.studies === 1 && pacsSort.caps >= 4 && pacsSort.track === true && pacsSort.verbs === true
      && pacsSort.accession.length > 0,
      JSON.stringify(pacsSort));
    // The bars are read as a column, so their right edges must be one line.
    // They were not: the bar and its state note shared a flexible cell, so
    // every bar stopped where its own note began and `NOT RETRIEVED` beside
    // `\u2713 74 IN CUBE` tore the edge. The note has a track of its own now,
    // wide enough for the longest thing a series ever says.
    const pacsBars = await evalIn(`
      const badges = [...document.querySelectorAll('#pacs-results .pacs-badge')];
      const bars = badges.map(b => b.querySelector('.listing-progress, .pacs-bar-full')).filter(Boolean)
        .map(el => Math.round(el.getBoundingClientRect().right));
      const notes = [...document.querySelectorAll('#pacs-results .pacs-badge-note')];
      const clipped = notes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent.trim());
      // The widest note a series can carry, measured where it would sit.
      let needed = 0, track = 0;
      if (notes.length > 0) {
        const probe = notes[0].cloneNode(true);
        probe.textContent = 'RETRIEVING 1410/1760';
        probe.style.width = 'max-content';
        notes[0].parentElement.appendChild(probe);
        needed = Math.ceil(probe.getBoundingClientRect().width);
        probe.remove();
        track = Math.round(notes[0].getBoundingClientRect().width);
      }
      const files = [...document.querySelectorAll('#pacs-results .pacs-series-files')];
      const fileRights = files.map(f => Math.round(f.getBoundingClientRect().right));
      return { bars: bars.length, edges: [...new Set(bars)], clipped, needed, track,
        filesFlush: fileRights.length > 1 ? Math.max(...fileRights) - Math.min(...fileRights) : 0,
        filesAlign: files[0] ? getComputedStyle(files[0]).textAlign : '' };`);
    check('every series bar ends on the same line, whatever its state says',
      pacsBars.bars > 1 && pacsBars.edges.length === 1, JSON.stringify(pacsBars));
    check('the state note has room for the longest thing a series says',
      pacsBars.clipped.length === 0 && pacsBars.track >= pacsBars.needed, JSON.stringify(pacsBars));
    check('the file counts are set flush right, so a column of them reads',
      pacsBars.filesAlign === 'right' && pacsBars.filesFlush === 0, JSON.stringify(pacsBars));

    check('sorting a study reorders its series, and reverses',
      pacsSort.rows > 1 && pacsSort.lit === true
      && pacsSort.ascending !== pacsSort.descending
      && pacsSort.ascending === pacsSort.ascending.split('|').sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).join('|'),
      JSON.stringify(pacsSort));
  }

  // The MRN level answers for a SET: every patient asked gets a row, and
  // what became of each is readable at a glance. Set SMOKE_PACS_COHORT to
  // a `pacs query --patients a,b` line whose MRNs include at least one the
  // PACS will not match.
  const pacsCohort = process.env.SMOKE_PACS_COHORT;
  if (!pacsCohort) {
    console.log('  skipped: set SMOKE_PACS_COHORT=<a `pacs query --patients a,b` line, one MRN a miss>');
  } else {
    const cohort = await evalIn(`
      document.getElementById('gutter-tools').click(); await sleep(600);
      const ws = document.getElementById('pacs-workspace');
      const cmd = ws.querySelector('#pacs-command');
      const rows = () => [...ws.querySelectorAll('#pacs-results .pacs-patient-row')];
      cmd.value = ${JSON.stringify(pacsCohort)};
      cmd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      for (let i = 0; i < 300; i++) { await sleep(1000); if (rows().length > 1) break; }
      await sleep(2000);
      const mrns = rows().map(r => r.querySelector('.pacs-patient-mrn')?.textContent ?? '');
      const studies = rows().map(r => r.querySelector('.pacs-patient-count')?.textContent ?? '');
      const answered = rows().map(r => r.querySelector('.pacs-patient-answered')?.textContent ?? '');
      const bar = ws.querySelector('.pane-state')?.textContent ?? '';
      const tracks = rows().filter(r => r.querySelector('.pacs-patient-progress .listing-progress')).length;
      // A crowd arrives folded; unfolding one patient shows its studies.
      const first = rows()[0];
      const foldedBefore = first.parentElement.classList.contains('pacs-patient-collapsed');
      first.click(); await sleep(400);
      const openAfter = !first.parentElement.classList.contains('pacs-patient-collapsed');
      const studyCaps = [...first.parentElement.querySelectorAll('.pacs-study-level .roster-cap')]
        .map(c => c.textContent.trim());
      // A term is typed in the column it fills: the study-level terms of
      // the form stand over the study caps, which are minted a level down.
      const l = (el) => Math.round(el.getBoundingClientRect().left);
      const caps = new Map([...first.parentElement.querySelectorAll('.pacs-study-level > .roster-caps .roster-cap')]
        .map(c => [c.dataset.key, l(c)]));
      const studyTerms = [...document.querySelectorAll('#pacs-form [data-key]')]
        .filter(c => ['date', 'accession', 'modality', 'server'].includes(c.dataset.key))
        .map(c => [c.dataset.key, caps.has(c.dataset.key) ? l(c) - caps.get(c.dataset.key) : 'no-cap']);
      return { count: rows().length, mrns, studies, answered, bar, tracks, foldedBefore, openAfter, studyCaps, studyTerms };`);
    check('every patient asked gets a row, misses included',
      cohort.count >= 2 && cohort.studies.includes('0'),
      JSON.stringify({ n: cohort.count, mrns: cohort.mrns, studies: cohort.studies }));
    check('the bar counts what was found, what was not, and what could not be asked',
      /FOUND \d+ · NONE \d+ · UNASKED \d+/.test(cohort.bar), JSON.stringify(cohort.bar));
    check('each patient row says how old its own answer is',
      Array.isArray(cohort.answered) && cohort.answered.every((text) => text.trim() !== ''),
      JSON.stringify(cohort.answered));
    check('a patient sums the progress of everything beneath it',
      cohort.tracks === cohort.count, JSON.stringify({ tracks: cohort.tracks, rows: cohort.count }));
    check('the form\'s study terms stand over the study caps, a level down',
      Array.isArray(cohort.studyTerms) && cohort.studyTerms.length === 4
      && cohort.studyTerms.every(([, delta]) => delta === 0),
      JSON.stringify(cohort.studyTerms));
    check('a cohort arrives folded, and a patient unfolds into its studies',
      cohort.foldedBefore === true && cohort.openAfter === true
      && cohort.studyCaps.includes('ACCESSION'),
      JSON.stringify({ folded: cohort.foldedBefore, open: cohort.openAfter, caps: cohort.studyCaps }));
  }
  }

  if (stage('verbs-fit-their-track')) {
    // A row's verbs must fit the track declared for them. The PACS series
    // track was sized for one verb; adding a second pushed the first out of
    // its cell, and the GATHER a whole workflow starts with went missing
    // from every series already in CUBE. Nothing caught it, because nothing
    // had ever asked whether a capsule lands inside the cell holding it.
    // Whatever listing is on stage answers: this needs no PACS of its own.
    const fit = await evalIn(`
      const bad = [];
      let cells = 0;
      for (const cell of document.querySelectorAll('.listing-actions')) {
        const box = cell.getBoundingClientRect();
        if (box.width === 0) continue;
        const verbs = [...cell.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0);
        if (verbs.length === 0) continue;
        cells += 1;
        for (const verb of verbs) {
          const v = verb.getBoundingClientRect();
          // A pixel of rounding is not an overflow; a whole capsule is.
          if (v.left < box.left - 1 || v.right > box.right + 1) {
            bad.push(\`\${verb.textContent.trim()} in a \${Math.round(box.width)}px track\`);
          }
        }
      }
      return { cells, bad: bad.slice(0, 6) };`);
    if (fit.cells === 0) {
      console.log('  skipped: no listing with row verbs on stage');
    } else {
      check('every row verb fits inside the track that holds it', fit.bad.length === 0, `${fit.cells} cells · ${fit.bad.join('; ')}`);
    }
  }

  if (stage('pacs-server-control')) {
    // SERVER is a choice, not a phrase: the cell reads its own state and
    // unfolds a strip of segments — the FILTER gesture, in the caps'
    // vocabulary. No dropdown, because LCARS has no popup layer, and no
    // ALL, because a fan-out is always something the operator named.
    const servers = await evalIn(`
      document.getElementById('gutter-tools').click(); await sleep(700);
      const ws = document.getElementById('pacs-workspace');
      const cell = ws.querySelector('#pacs-f-server');
      const strip = ws.querySelector('#pacs-server-strip');
      const restingHidden = strip.hidden;
      cell.click();
      for (let i = 0; i < 120; i++) { await sleep(250);
        if (strip.querySelectorAll('.pacs-server-segment').length > 0) break; }
      const segments = [...strip.querySelectorAll('.pacs-server-segment')].map(s => s.textContent.trim());
      const noAll = !segments.some(s => /^ALL$/i.test(s));
      // One chosen is a context; several is a query, and only the fan-out
      // reaches the line.
      const first = strip.querySelector('.pacs-server-segment');
      first.click(); await sleep(300);
      const oneCell = cell.textContent.trim();
      const oneLine = ws.querySelector('#pacs-command').value;
      const second = [...strip.querySelectorAll('.pacs-server-segment')][1];
      let manyCell = '', manyLine = '', lit = 0;
      if (second) {
        second.click(); await sleep(300);
        manyCell = cell.textContent.trim();
        manyLine = ws.querySelector('#pacs-command').value;
        lit = strip.querySelectorAll('.pacs-server-chosen').length;
      }
      // Esc retracts it, exactly as it retracts a mode frame.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
      const closedByEsc = strip.hidden;
      return { restingHidden, segments: segments.length, noAll,
        oneCell, oneLine, manyCell, manyLine, lit, closedByEsc };`);
    check('the SERVER cell unfolds a strip carrying every registered server',
      servers.restingHidden === true && servers.segments > 0,
      JSON.stringify(servers));
    check('the strip offers no ALL: a fan-out is always something the operator named',
      servers.noAll === true, JSON.stringify(servers.segments));
    check('one server reads as itself and adds no flag; several reads +n and lowers to a fan-out',
      servers.oneCell !== '' && !servers.oneLine.includes('--pacsserver')
      && /\+1$/.test(servers.manyCell) && servers.manyLine.includes('--pacsserver')
      && servers.lit === 2,
      JSON.stringify(servers));
    check('Esc retracts the server strip, as it retracts a mode frame',
      servers.closedByEsc === true, JSON.stringify(servers.closedByEsc));
  }

  if (stage('console-asks')) {
    // The session can ask this surface a question now. A `text` or a
    // `secret` is answered in the console — where the session speaks, and
    // where the scrollback keeps what was asked — and a secret never enters
    // the transcript, not even as a length. A `path` borrows an instrument
    // instead, which is the ask-errand scenario.
    const asks = await evalIn(`
      const term = () => document.querySelector('#terminal input');
      const lines = () => [...document.querySelectorAll('#terminal .argus-ask')];
      const run = (line) => { const t = term(); t.value = line;
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      const key = (k) => term().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

      // The scrollback keeps every question ever asked, answered ones
      // included, so everything here is counted from where this scenario
      // started: the asks it causes are the ones after that mark, and the
      // capsules it presses are the newest — pressing the first NO on the
      // page presses one an earlier scenario already answered.
      await console_idle();
      const askedBefore = lines().length;
      const capsulesBefore = document.querySelectorAll('#terminal .ask-capsule').length;

      // sudo asks for an administrator username, then a password. Answering
      // the first and abandoning the second establishes nothing.
      run('sudo plugin add pl-no-such-plugin-for-smoke');
      for (let i = 0; i < 120; i++) { await sleep(500); if (lines().length > askedBefore) break; }
      if (lines().length <= askedBefore) return { asked: false };
      const first = lines()[askedBefore].textContent ?? '';
      const typeAtText = term().type;
      term().value = 'not-a-real-admin'; key('Enter');
      for (let i = 0; i < 120; i++) { await sleep(300); if (lines().length > askedBefore + 1) break; }
      const typeAtSecret = term().type;
      term().value = 'smoke-secret-value';
      key('Escape'); await sleep(1200);
      const abandoned = (lines()[askedBefore + 1]?.textContent ?? '').includes('abandoned');
      const leaked = document.getElementById('terminal').textContent.includes('smoke-secret-value');
      const glyph = document.querySelector('.argus-input-glyph').textContent;

      // A yes/no is two capsules, and pressing one answers it.
      await console_idle();
      run('rm -i /home/__no_such_file_for_smoke__');
      let capsules = 0;
      for (let i = 0; i < 120; i++) { await sleep(250);
        capsules = document.querySelectorAll('#terminal .ask-capsule').length - capsulesBefore;
        if (capsules > 0) break; }
      if (capsules > 0) {
        [...document.querySelectorAll('#terminal .ask-capsule')].filter(c => c.textContent === 'NO').pop().click();
        await sleep(800);
      }
      return { asked: true, first, typeAtText, typeAtSecret, abandoned, leaked, glyph, capsules,
        settled: document.querySelector('.argus-input-glyph').textContent === '❯' };`);
    if (asks.asked === false) {
      console.log('  skipped: no question arrived (sudo did not reach its prompt)');
    } else {
      check('the session can put a question to this surface, in the console',
        /administrator/i.test(asks.first ?? ''), JSON.stringify(asks.first));
      check('a secret is masked, and never enters the transcript',
        asks.typeAtText === 'text' && asks.typeAtSecret === 'password' && asks.leaked === false,
        JSON.stringify({ text: asks.typeAtText, secret: asks.typeAtSecret, leaked: asks.leaked }));
      check('Esc abandons a question, and the transcript says so',
        asks.abandoned === true && asks.glyph === '❯', JSON.stringify(asks.abandoned));
      if (asks.capsules === 0) {
        console.log('  skipped: no yes/no arrived (nothing asked one)');
      } else {
        check('a yes/no is two capsules, and pressing one answers it',
          asks.capsules === 2 && asks.settled === true,
          JSON.stringify({ capsules: asks.capsules, settled: asks.settled }));
      }
    }
  }

  if (stage('ask-errand')) {
    // An ask is never a box: a location borrows the instrument that already
    // shows that space. A NEW browser opens beside the asker, anchored
    // where the ask said, with the errand's controls on its own frame.
    //
    // Without an MRN that has imaging the query never reaches its write, so
    // there is nothing to ask and nothing to test — and a fan-out to a real
    // PACS for a nonsense MRN sits in the session queue for minutes, where
    // every later scenario's command waits behind it. So it is not issued.
    const errand = !process.env.SMOKE_PACS_MRN ? { opened: false, unset: true } : await evalIn(`
      const term = () => document.querySelector('#terminal input');
      const run = (line) => { const t = term(); t.value = line;
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      const panes = () => document.querySelectorAll('#layout-root .layout-leaf').length;
      const before = panes();
      // A query that replays: the errand is what this scenario is about,
      // not how long a PACS takes to answer a question it has answered
      // before. SMOKE_PACS_MRN names an MRN with imaging.
      run(${JSON.stringify(`pacs query PatientID:${process.env.SMOKE_PACS_MRN ?? '__smoke__'} --csv-to`)});
      let opened = false;
      for (let i = 0; i < 240; i++) { await sleep(500);
        if (document.querySelector('.errand-commit')) { opened = true; break; } }
      if (!opened) return { opened: false };
      const caption = document.querySelector('.errand-caption')?.textContent ?? '';
      const commit = document.querySelector('.errand-commit')?.textContent ?? '';
      const composed = document.querySelector('.errand-path')?.value ?? '';
      const grew = panes() > before;
      // The errand's controls ride a bar of their own across the top of the
      // pane it borrowed, not the mode frame — which is a narrow rail
      // against the spine, and answers to what the field holds.
      const barred = document.querySelector('.errand-bar')?.parentElement?.classList.contains('files-body') === true;
      // Polled, never slept: the listing lands when the daemon answers, and
      // a fixed wait either samples before it or wastes the difference.
      const listing = () => document.querySelector('.errand-bar')?.closest('.files-body')
        ?.querySelectorAll('.files-row').length ?? 0;
      let rows = 0;
      for (let i = 0; i < 80; i++) { await sleep(250); rows = listing(); if (rows > 0) break; }
      // The console states the question too, so the scrollback holds it.
      const noted = [...document.querySelectorAll('#terminal .argus-ask')]
        .some(el => /where should the table go/i.test(el.textContent ?? ''));
      // Esc abandons: the pane closes, the layout comes back, and the
      // command is told rather than left waiting.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(1500);
      const closed = document.querySelector('.errand-commit') === null && panes() === before;
      const said = [...document.querySelectorAll('#terminal .argus-ask')]
        .some(el => (el.textContent ?? '').includes('abandoned'));
      return { opened: true, caption, commit, composed, grew, barred, rows, noted, closed, said };`);
    if (errand.opened === false) {
      console.log(errand.unset
        ? '  skipped: set SMOKE_PACS_MRN=<an MRN with imaging> for the location ask'
        : '  skipped: no location was asked for (the query never reached its write)');
    } else {
      check('a location ask opens a browser beside the asker, carrying the errand on its own bar',
        errand.grew === true && errand.barred === true && /where should the table go/i.test(errand.caption),
        JSON.stringify({ grew: errand.grew, barred: errand.barred, caption: errand.caption }));
      // A question that blocks the command that asked it must not block the
      // browsing that answers it: the errand's listings are instrument
      // reads, and they run beside the waiting command rather than behind
      // it. An empty errand is a deadlock wearing a pane.
      check('the errand browses while the command that asked waits',
        errand.rows > 0, JSON.stringify({ rows: errand.rows }));
      check('the committing verb reads what the kernel said it does',
        errand.commit === 'EXPORT HERE', JSON.stringify(errand.commit));
      check('the answer is composed from where the browser stands, and is editable',
        /\.csv$/.test(errand.composed ?? ''), JSON.stringify(errand.composed));
      check('the console states the question the errand answers',
        errand.noted === true, JSON.stringify(errand.noted));
      check('Esc abandons the errand: the pane closes and the command is told',
        errand.closed === true && errand.said === true, JSON.stringify(errand));
    }
  }

  if (stage('host-control')) {
  // The HOST lamp reads the attach ack's declared tiers and nothing else:
  // present exactly when the daemon declared host control, absent at rest.
  // And `!` on a daemon without the policy refuses by name.
  const hostControl = await evalIn(`
    const lamp = document.getElementById('status-host');
    const lit = lamp.textContent.trim();
    const input = document.querySelector('#terminal input');
    // Output lands above the prompt line, so read the whole transcript for
    // a token no other scenario prints.
    const token = 'argus-host-probe-' + Date.now();
    await console_idle();
    input.value = '!echo ' + token; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // The answer is a token no other scenario prints, or a refusal by name;
    // polled, since a fixed wait either samples before it or wastes the rest.
    const streams = () => [...document.querySelectorAll('#terminal .argus-stream')].map(s => s.textContent).join(' ');
    const errors = () => [...document.querySelectorAll('#terminal .argus-result.error')].map(s => s.textContent).join(' ');
    let ran = false, refusedByName = false;
    for (let i = 0; i < 60; i++) { await sleep(250);
      ran = streams().includes(token); refusedByName = errors().includes('--host-control');
      if (ran || refusedByName) break; }
    return { lit, ran, refusedByName };`);
  if (hostControl.lit !== '') {
    check('the HOST lamp reads the daemon\'s declared tiers, and ! runs on the host', /^HOST /.test(hostControl.lit) && hostControl.ran, JSON.stringify(hostControl));
  } else {
    check('the HOST lamp reads the daemon\'s declared tiers: absent at rest, and ! refuses by name', hostControl.lit === '' && hostControl.refusedByName && !hostControl.ran, JSON.stringify(hostControl));
  }
  }

  if (stage('roster-totals')) {
  // The roster's totals ride the same grid as its other columns: caps for
  // SIZE and TIME, one cell per cap on every row, a dash (never a zero)
  // where a feed's nodes are not resident, a number where they are.
  //
  // Counted against the caps rather than a literal: the track list is
  // positional, so "as many cells as caps" is the invariant that protects
  // the grid, and it needs no edit when a column is added.
  const totals = await evalIn(`
    document.getElementById('gutter-runs').click(); await sleep(800);
    for (let i = 0; i < 60; i++) { await sleep(500); if (document.querySelector('.feedlist-row')) break; }
    const dp = [...document.querySelectorAll('.pane-dag')].find(p => p.offsetParent !== null);
    const caps = [...dp.querySelectorAll('.roster-cap')].map(c => c.textContent.replace(/[▲▼\\s]/g, ''));
    const rows = [...dp.querySelectorAll('.feedlist-row')];
    const cells = rows.map(r => r.children.length);
    // The invariant that protects the grid is that every row holds as many
    // cells as the grid has TRACKS — the caps head only the sortable columns,
    // and the action track is a real track with no cap of its own.
    const tracks = rows.length > 0 ? getComputedStyle(rows[0]).gridTemplateColumns.split(' ').length : 0;
    const sizes = rows.map(r => r.querySelector('.feedlist-size')?.textContent ?? '');
    return { caps, tracks, cellsUniform: rows.length > 0 && tracks >= caps.length && cells.every(n => n === tracks), rows: rows.length, honest: sizes.every(s => s === '—' || /\\d/.test(s)) };`);
  check('the roster carries SIZE and TIME on its grid, dashes where nodes are not resident', totals.caps.includes('SIZE') && totals.caps.includes('TIME') && totals.cellsUniform && totals.rows > 0 && totals.honest, JSON.stringify(totals));
  }

  if (stage('theme-cycle')) {
  // A theme is one declaration on the root element, and the pill cycles it.
  // PHAROS is the theme with shapes of its own: reached by the pill, it must
  // be readable back off the caps — a chamfered cap in the language's face —
  // and leaving it must restore what the browser had.
  const themed = await evalIn(`
    const pill = document.getElementById('theme-pill');
    const root = document.documentElement;
    const before = root.dataset.theme ?? null;
    const capOf = () => document.querySelector('.roster-cap');
    document.getElementById('gutter-files').click(); await sleep(600);
    for (let i = 0; i < 30; i++) { await sleep(300); if (capOf()) break; }
    let steps = 0;
    while (root.dataset.theme !== 'pharos' && steps < 8) { pill.click(); await sleep(120); steps += 1; }
    const cap = capOf();
    const style = cap ? getComputedStyle(cap) : null;
    const under = {
      theme: root.dataset.theme ?? null, label: pill.textContent.trim(),
      radius: style ? style.borderTopLeftRadius : null,
      chamfer: style ? style.clipPath : null,
      face: style ? style.fontFamily : null,
      capBg: style ? style.backgroundColor : null,
    };
    // Cycle on until the browser's own choice is back.
    let back = 0;
    while ((root.dataset.theme ?? null) !== before && back < 8) { pill.click(); await sleep(120); back += 1; }
    return { before, under, restored: (root.dataset.theme ?? null) === before };`);
  check('the pill reaches PHAROS and the caps read as the language: a chamfered cap in its own face',
    themed.under.theme === 'pharos' && themed.under.label === 'PHAROS'
    && themed.under.radius === '0px' && /^polygon\(/.test(themed.under.chamfer ?? '') && /Chakra/.test(themed.under.face ?? ''),
    JSON.stringify(themed.under));
  check('leaving PHAROS restores the theme the browser had', themed.restored, JSON.stringify(themed));
  }

  if (stage('nameplate')) {
  const seal = await evalIn(`
    const mark = document.querySelector('.brand-mark');
    if (!mark) return { present: false };
    const style = getComputedStyle(mark);
    const r = mark.getBoundingClientRect();
    return { present: true, masked: style.maskImage.includes('url'), visible: r.width > 20 && r.height > 10 };`);
  check('the nameplate seal is present, masked, and visible', seal.present && seal.masked && seal.visible);
  }

  if (stage('running-row')) {
  // The RUNNING row on the ARGUS WEB face reads the lab's pulse, and its
  // ERRORED figure is a press: it opens the runs roster filtered to the
  // feeds with errored jobs, and the bar says FILTERED.
  const pulse = await evalIn(`
    const box = document.getElementById('index-instrument');
    await console_idle(); await sleep(1500);
    const row = [...box.querySelectorAll('.index-row')].find((r) => /RUNNING/.test(r.textContent));
    const press = row?.querySelector('.index-verb');
    if (!row || !press) return { row: row?.textContent ?? null, pressed: false };
    press.click();
    let rows = 0, bar = '';
    for (let i = 0; i < 120; i++) { await sleep(250); rows = document.querySelectorAll('.feedlist-row').length; bar = document.querySelector('#layout-root .listing-state, .feedlist-state, .roster-state')?.textContent ?? ''; if (rows > 0) break; }
    await sleep(600);
    const statuses = [...document.querySelectorAll('.feedlist-row')].map((r) => r.textContent).filter((t) => t.length > 0);
    const allErrored = statuses.every((t) => /ERROR/.test(t));
    return { row: row.textContent, pressed: true, rows, allErrored, filterOpen: !!document.querySelector('.roster-filter:not([hidden])') };`);
  check('the RUNNING row reads the lab\'s pulse with an ERRORED press', pulse.pressed && /RUNNING\d/.test(pulse.row ?? ''), JSON.stringify(pulse));
  check('the ERRORED figure opens the roster filtered to errored feeds', pulse.rows > 0 && pulse.allErrored && pulse.filterOpen, JSON.stringify(pulse));
  }

  if (stage('lane-instrument')) {
  // LANE, BEAT and CUBE on the ARGUS WEB face: the lane reads IDLE while a
  // feed indexes (the walk is off the lane), the beat is fresh, and CUBE's
  // pace is a number once a page has been fetched.
  const bigFeed = process.env.SMOKE_BIG_FEED ?? '';
  const lanes = await evalIn(`
    const box = document.getElementById('lane-instrument');
    const rows = () => Object.fromEntries([...box.querySelectorAll('.lane-row')].map((r) => [r.querySelector('.telemetry-label').textContent, r.querySelector('.telemetry-value').textContent]));
    await console_idle(); await sleep(1500);
    const idle = rows();
    if ('${bigFeed}' === '') return { idle, skipped: true };
    const input = document.querySelector('#terminal input');
    input.value = 'proc refresh ${bigFeed}'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    let during = null;
    for (let i = 0; i < 120; i++) { await sleep(250); if (/FEED ${bigFeed} /.test(document.getElementById('status-jobs').textContent)) { await sleep(1200); during = rows(); break; } }
    for (let i = 0; i < 480 && /FEED ${bigFeed} /.test(document.getElementById('status-jobs').textContent); i++) await sleep(250);
    await sleep(1500);
    return { idle, during, after: rows() };`);
  check('the lane reads IDLE and the beat is fresh on a quiet session', /^IDLE/.test(lanes.idle.LANE ?? '') && /^[0-2]\.\d S AGO$/.test(lanes.idle.BEAT ?? ''), JSON.stringify(lanes.idle));
  if (lanes.skipped) {
    console.log('  skipped the walk: set SMOKE_BIG_FEED=<id>');
  } else {
    check('the lane stays IDLE while a feed indexes off it', lanes.during !== null && /^IDLE/.test(lanes.during.LANE ?? ''), JSON.stringify(lanes.during));
    check('CUBE has a pace once pages were fetched', /S\/PAGE · \d+ PAGES\/MIN$/.test(lanes.after.CUBE ?? ''), JSON.stringify(lanes.after));
  }
  }

  if (stage('header-index')) {
  // The INDEX instrument on the header's resting face: a quiet index reads
  // CURRENT; a feed's walk takes a row with a bar and its count; the row
  // goes when the walk lands. Same context the status line reads.
  const bigFeed = process.env.SMOKE_BIG_FEED ?? '';
  const instrument = await evalIn(`
    const box = document.getElementById('index-instrument');
    await console_idle();
    const idle = box.textContent;
    const idleRows = box.querySelectorAll('.index-row').length;
    if ('${bigFeed}' === '') return { idle, idleRows, skipped: true };
    const input = document.querySelector('#terminal input');
    input.value = 'proc refresh ${bigFeed}'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    let named = '', barred = false;
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      const row = [...box.querySelectorAll('.index-row')].find((r) => /FEED ${bigFeed}/.test(r.textContent));
      if (row) { named = row.textContent; if (row.querySelector('.index-bar .listing-progress-fill')) barred = true; }
      if (named && !row) break;
    }
    for (let i = 0; i < 480 && /FEED ${bigFeed}/.test(box.textContent); i++) await sleep(250);
    return { idle, idleRows, named, barred, after: box.textContent, afterRows: box.querySelectorAll('.index-row').length };`);
  // The pulse row (RUNNING) is permanent too; quiet means no walk row.
  check('a quiet index reads CURRENT on the header, with no walk row', /CURRENT/.test(instrument.idle) && !/FEED \d/.test(instrument.idle), JSON.stringify(instrument));
  if (instrument.skipped) {
    console.log('  skipped the walk: set SMOKE_BIG_FEED=<id> to a feed of about a thousand nodes');
  } else {
    check('a feed being indexed takes a row of its own with a bar and its count', /INDEXING \d/.test(instrument.named) && instrument.barred, JSON.stringify(instrument));
    check('the row goes when the walk lands and the index reads CURRENT again', !/FEED \d/.test(instrument.after) && /CURRENT/.test(instrument.after), JSON.stringify(instrument));
  }
  }

  if (stage('lane')) {
  // Index movement never holds the lane: `proc refresh <id>` starts a feed's
  // re-walk and answers at once that the feed is indexing; a command sent
  // right behind it answers while the walk still counts on the JOBS readout.
  const bigFeed = process.env.SMOKE_BIG_FEED ?? '';
  if (bigFeed === '') {
    console.log('  skipped: set SMOKE_BIG_FEED=<id> to a feed of about a thousand nodes');
  } else {
    const lane = await evalIn(`
      const input = document.querySelector('#terminal input');
      const jobs = document.getElementById('status-jobs');
      const say = (line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      await console_idle();
      const t0 = performance.now();
      say('proc refresh ${bigFeed}');
      await sleep(80);
      await console_idle();
      const refreshMs = Math.round(performance.now() - t0);
      const walking = /FEED ${bigFeed} /.test(jobs.textContent);
      const term = document.getElementById('terminal').textContent;
      const answeredIndexing = /Feed ${bigFeed}: indexing/.test(term);
      const t1 = performance.now();
      say('ls ~');
      await sleep(80);
      await console_idle();
      const lsMs = Math.round(performance.now() - t1);
      const stillWalking = /FEED ${bigFeed} /.test(jobs.textContent);
      for (let i = 0; i < 480 && /FEED ${bigFeed} /.test(jobs.textContent); i++) await sleep(250);
      return { refreshMs, walking, answeredIndexing, lsMs, stillWalking, cleared: !/FEED ${bigFeed} /.test(jobs.textContent) };`);
    check('a cold walk returns the lane at once', lane.answeredIndexing && lane.refreshMs < 3000, JSON.stringify(lane));
    check('a command sent behind the walk answers while the feed still indexes', lane.walking && lane.stillWalking, JSON.stringify(lane));
    check('the walk lands and its readout clears', lane.cleared, JSON.stringify(lane));
  }
  }

  if (stage('index-annunciation')) {
  // A feed's first-visit topology load is never a silent hang: the JOBS
  // readout names the feed and counts its instances while the daemon walks
  // it. `proc refresh <id>` drops and re-walks one feed, which is the same
  // path a first visit takes; only a feed large enough to outlast one
  // telemetry tick can be observed, so the scenario needs SMOKE_BIG_FEED.
  const bigFeed = process.env.SMOKE_BIG_FEED ?? '';
  if (bigFeed === '') {
    console.log('  skipped: set SMOKE_BIG_FEED=<id> to a feed of about a thousand nodes (one that outlasts a telemetry tick yet finishes within the wait)');
  } else {
    const indexing = await evalIn(`
      const input = document.querySelector('#terminal input');
      const jobs = document.getElementById('status-jobs');
      await console_idle();
      input.value = 'proc refresh ${bigFeed}'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      let seen = ''; let counted = false;
      for (let i = 0; i < 240; i++) {
        await sleep(250);
        const text = jobs.textContent;
        if (/FEED ${bigFeed} \\d+/.test(text)) { seen = text; if (/FEED ${bigFeed} [1-9]\\d*\\/[1-9]/.test(text)) counted = true; }
        if (seen && !/FEED ${bigFeed} /.test(text)) break;
      }
      for (let i = 0; i < 480 && /FEED ${bigFeed} /.test(jobs.textContent); i++) await sleep(250);
      return { seen, counted, cleared: !/FEED ${bigFeed} /.test(jobs.textContent) };`);
    check('the JOBS readout names a feed being indexed and counts its instances', indexing.seen !== '' && indexing.counted, JSON.stringify(indexing));
    check('the feed indexing readout clears when the walk completes', indexing.cleared, JSON.stringify(indexing));
  }
  }

  // ---------------------------------------------------------------- image
  // An image pane on a guest engine's field. Needs a DICOM series folder
  // on the daemon's CFS (SMOKE_DICOM_SERIES=<folder>, e.g. the synthesized
  // series the S7 fixtures upload) and, optionally, a volume
  // (SMOKE_NIFTI=<path>). Assertions read mise's seams — state, bar,
  // console lines, focus — never the engine's internals.
  // Without a series named in the environment, the suite makes its own:
  // synthesized fixtures written now, put on the daemon through its own
  // /vfs route under the identity's uploads, and removed at the end.
  let dicomSeries = process.env.SMOKE_DICOM_SERIES ?? '';
  let niftiPath = process.env.SMOKE_NIFTI ?? '';
  let fixtureFolder = null;
  if (dicomSeries === '' && process.env.SMOKE_NO_FIXTURES === undefined) {
    const { series_write, nifti_write, SERIES_FOLDER } = await import('./fixtures/synth.mjs');
    const { mkdtempSync, readFileSync: read } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, basename } = await import('node:path');
    const local = mkdtempSync(join(tmpdir(), 'argus-smoke-fixtures-'));
    const slices = series_write(local);
    const nifti = nifti_write(join(local, 'sphere.nii.gz'));
    const home = await evalIn(`
      await console_idle();
      const input = document.querySelector('#terminal input');
      input.value = 'cd ~; pwd'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      for (let i = 0; i < 40; i++) { await sleep(250); const m = document.getElementById('terminal').innerText.split('\\n').map((l) => l.trim()).reverse().find((l) => /^\\/home\\/[^\\s]+$/.test(l)); if (m) return m; }
      return null;`);
    if (home === null) {
      console.log('  fixtures: could not learn the identity\'s home; image scenarios will skip');
    } else {
      const url = new URL(argusUrl_discover());
      const token = url.searchParams.get('token') ?? '';
      fixtureFolder = `${home}/uploads/argus-smoke-${Date.now()}`;
      const put = async (localPath, remotePath) => {
        const response = await fetch(`${url.origin}/vfs?path=${encodeURIComponent(remotePath)}&token=${encodeURIComponent(token)}`, { method: 'POST', body: read(localPath) });
        if (!response.ok) throw new Error(`upload ${remotePath}: HTTP ${response.status}`);
      };
      try {
        for (const slice of slices) await put(slice, `${fixtureFolder}/${SERIES_FOLDER}/${basename(slice)}`);
        await put(nifti, `${fixtureFolder}/sphere.nii.gz`);
        dicomSeries = `${fixtureFolder}/${SERIES_FOLDER}`;
        niftiPath = `${fixtureFolder}/sphere.nii.gz`;
        console.log(`  fixtures: ${slices.length} slices and a NIfTI put under ${fixtureFolder}`);
      } catch (error) {
        console.log(`  fixtures: ${error.message}; image scenarios will skip`);
        fixtureFolder = null;
      }
    }
  }
  if (stage('image-pane')) {
  if (dicomSeries === '') {
    console.log('  skipped: set SMOKE_DICOM_SERIES=<series folder on the daemon>');
  } else {
    await evalIn(`await console_idle();`);
    const opened = await evalIn(`
      document.getElementById('gutter-files').click(); await sleep(600);
      const pane = document.querySelector('.pane-files');
      pane.querySelector('.pane-handle').click(); await sleep(150);
      pane.querySelector('[data-split="col"][data-place="after"]').click(); await sleep(600);
      const prompt = document.querySelector('.empty-prompt'); if (!prompt) return { error: 'no empty prompt' };
      prompt.value = 'dcm series ${dicomSeries}';
      prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      let image = null;
      for (let i = 0; i < 120; i++) { await sleep(500); image = document.querySelector('.pane-image'); if (image && /SLICE \\d+ OF \\d+/.test(image.querySelector('.pane-state').textContent)) break; }
      if (!image) return { error: 'no image pane' };
      const state = image.querySelector('.pane-state').textContent;
      // The engine sizes its canvas on its next frame; measure after it.
      await sleep(600);
      const field = image.querySelector('.image-field').getBoundingClientRect();
      const canvas = image.querySelector('.image-field canvas');
      const c = canvas ? canvas.getBoundingClientRect() : null;
      const fits = c !== null && Math.abs(c.width - field.width) < 4 && Math.abs(c.height - field.height) < 4;
      const dprOk = canvas !== null && Math.abs(canvas.width - c.width * devicePixelRatio) < 4;
      const inField = image.querySelector('.image-field button, .image-field .strategy-pill') === null;
      const onFrame = image.querySelectorAll('.mode-frame .image-tool').length;
      const hue = image.dataset.modality;
      const noted = document.getElementById('terminal').innerText.split('\\n').some((l) => /^image: \\d+ slices, first on screen in \\d+ ms/.test(l.trim()));
      const r = image.querySelector('.image-viewport').getBoundingClientRect();
      return { state, fits, dprOk, canvasPx: canvas ? canvas.width : null, cssPx: c ? Math.round(c.width) : null, dpr: devicePixelRatio, inField, onFrame, hue, noted, wheelAt: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };`);
    // The wheel over the field turns the stack; the page stays put. A real
    // wheel through the debugger, as the operator's would arrive.
    if (opened.error === undefined) {
      for (let i = 0; i < 3; i++) {
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: opened.wheelAt.x, y: opened.wheelAt.y, deltaX: 0, deltaY: 120 });
        await new Promise((r) => setTimeout(r, 250));
      }
      const turned = await evalIn(`
        const image = document.querySelector('.pane-image');
        let after = image.querySelector('.pane-state').textContent;
        for (let i = 0; i < 40 && /SLICE 1 OF/.test(after); i++) { await sleep(100); after = image.querySelector('.pane-state').textContent; }
        return { after, scrollY: window.scrollY };`);
      opened.after = turned.after;
      opened.scrollY = turned.scrollY;
    }
    check('an image pane opens on a series with the first slice on its bar', opened.error === undefined && /SLICE 1 OF \d+/.test(opened.state), JSON.stringify(opened));
    check('the engine\'s canvas fills its mount at the device pixel ratio', opened.fits === true && opened.dprOk === true, JSON.stringify(opened));
    check('no control sits inside the image field and the tool blocks ride the frame', opened.inField === true && opened.onFrame === 6, JSON.stringify(opened));
    check('the frame wears the modality as its hue', typeof opened.hue === 'string' && opened.hue.length > 0, JSON.stringify(opened));
    check('the wheel over the field turns the stack and the page stays put', opened.after !== opened.state && /SLICE [2-9]/.test(opened.after ?? '') && opened.scrollY === 0, JSON.stringify(opened));
    check('the pane says in the console when the first slice landed', opened.noted === true, JSON.stringify(opened));
  }
  }
  if (stage('image-focus')) {
  if (dicomSeries === '' || !(await evalIn(`return document.querySelector('.pane-image') !== null;`))) {
    console.log('  skipped: needs the image pane from image-pane');
  } else {
    const focus = await evalIn(`
      const image = document.querySelector('.pane-image');
      const field = image.querySelector('.image-field');
      field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await sleep(150);
      const taken = field.contains(document.activeElement) || document.activeElement === field;
      const markOn = !image.querySelector('.image-focus').hidden;
      // A key pressed on the field stays there: the drawer's verbs do not walk.
      const drawerBefore = image.querySelector('.pane-drawer').hidden;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await sleep(100);
      const drawerAfter = image.querySelector('.pane-drawer').hidden;
      // Esc gives the keyboard back, one press, one level: the frame it did not touch stays as it was.
      image.dataset.modes = 'open';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
      const released = !(field.contains(document.activeElement) || document.activeElement === field);
      const markOff = image.querySelector('.image-focus').hidden;
      const frameStillOpen = image.dataset.modes === 'open';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
      const frameClosedNext = image.dataset.modes !== 'open';
      return { taken, markOn, drawerBefore, drawerAfter, released, markOff, frameStillOpen, frameClosedNext };`);
    check('the image field keeps the keyboard until Esc', focus.taken && focus.markOn && focus.drawerBefore === focus.drawerAfter && focus.released && focus.markOff, JSON.stringify(focus));
    check('Esc from the field is one level: the open frame waits for the next press', focus.frameStillOpen && focus.frameClosedNext, JSON.stringify(focus));
  }
  }
  if (stage('image-verbs')) {
  if (dicomSeries === '' || !(await evalIn(`return document.querySelector('.pane-image') !== null;`))) {
    console.log('  skipped: needs the image pane from image-pane');
  } else {
    const verbs = await evalIn(`
      await console_idle();
      const image = document.querySelector('.pane-image');
      image.click();
      const input = document.querySelector('#terminal input');
      const run = async (line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300); };
      await run('image slice 4');
      let slice = image.querySelector('.pane-state').textContent;
      for (let i = 0; i < 40 && !/SLICE 4 OF/.test(slice); i++) { await sleep(100); slice = image.querySelector('.pane-state').textContent; }
      await run('image colormap hot');
      const colormap = image.querySelector('.image-colormap').textContent;
      await run('image layout mpr');
      let mode = '';
      for (let i = 0; i < 120; i++) { await sleep(500); mode = image.querySelector('.pane-mode').textContent; if (mode === 'MPR' && image.querySelectorAll('.image-mpr .image-viewport').length === 3) break; }
      const planes = image.querySelectorAll('.image-mpr .image-viewport').length;
      const layoutPill = image.querySelector('.image-layout').textContent;
      await run('image layout single');
      await settled(() => image.querySelector('.pane-state').textContent, { limit: 6000 });
      const back = image.querySelector('.pane-mode').textContent;
      return { slice, colormap, mode, planes, layoutPill, back };`);
    check('image slice <n> moves the stack and the bar says which slice', /SLICE 4 OF/.test(verbs.slice ?? ''), JSON.stringify(verbs));
    check('image colormap names the block', verbs.colormap === 'HOT', JSON.stringify(verbs));
    check('image layout mpr stands three linked planes and the bar annunciates the mode', verbs.mode === 'MPR' && verbs.planes === 3 && verbs.layoutPill === 'MPR', JSON.stringify(verbs));
    check('image layout single returns and the mode annunciation clears', verbs.back === '', JSON.stringify(verbs));
  }
  }
  if (stage('image-tags')) {
  if (dicomSeries === '' || !(await evalIn(`return document.querySelector('.pane-image') !== null;`))) {
    console.log('  skipped: needs the image pane from image-pane');
  } else {
    const tags = await evalIn(`
      await console_idle();
      const input = document.querySelector('#terminal input');
      const run = async (line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300); };
      await run('image layout single');
      await run('image slice 2');
      await run('image tags');
      let pane = null;
      for (let i = 0; i < 60; i++) { await sleep(500); pane = document.querySelector('.pane-tags'); if (pane && pane.querySelectorAll('.tags-row').length > 0) break; }
      if (!pane) return { error: 'no tags pane' };
      const groups = [...pane.querySelectorAll('.tags-group-row .tags-group-name')].map((e) => e.textContent);
      const rowOf = (name) => [...pane.querySelectorAll('.tags-row')].find((r) => r.querySelector('.tags-name')?.textContent === name);
      const instance = () => rowOf('InstanceNumber')?.querySelector('.tags-value')?.textContent ?? null;
      const before = instance();
      const phiBefore = rowOf('PatientName')?.querySelector('.tags-value')?.textContent ?? null;
      const redactBlock = pane.querySelector('.tags-redact').textContent;
      const state = pane.querySelector('.pane-state').textContent;
      // The image pane moves; the tags pane follows.
      await run('image slice 5');
      let after = before;
      for (let i = 0; i < 40 && after === before; i++) { await sleep(150); after = instance(); }
      // REDACT off reveals; on hides again.
      await run('tags redact off');
      await sleep(300);
      const phiRevealed = rowOf('PatientName')?.querySelector('.tags-value')?.textContent ?? null;
      await run('tags redact on');
      await sleep(300);
      const phiHidden = rowOf('PatientName')?.querySelector('.tags-value')?.textContent ?? null;
      // The filter narrows, and descends into a sequence.
      await run('tags filter Position');
      await sleep(400);
      const filtered = [...pane.querySelectorAll('.tags-row')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => r.querySelector('.tags-name')?.textContent);
      await run('tags filter ReferencedSOPClass');
      await sleep(400);
      const deep = [...pane.querySelectorAll('.tags-row')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => r.querySelector('.tags-name')?.textContent);
      await run('tags filter off');
      await sleep(300);
      const hue = pane.dataset.modality;
      const sameGroup = pane.closest('.layout-leaf') !== null;
      return { groups, before, after, phiBefore, phiRevealed, phiHidden, redactBlock, state, filtered, deep, hue, sameGroup };`);
    check('image tags opens a tags pane beside the image pane with module groups', tags.error === undefined && tags.groups.includes('PATIENT') && tags.groups.includes('IMAGE') && tags.sameGroup, JSON.stringify(tags));
    check("the tags pane follows the image pane's slice", tags.before === '2' && tags.after === '5', JSON.stringify(tags));
    check('identifying values show redacted until REDACT says otherwise', tags.phiBefore === '••••' && tags.phiRevealed !== '••••' && tags.phiRevealed !== null && tags.phiHidden === '••••' && /REDACT ON/.test(tags.redactBlock) && /REDACTED/.test(tags.state), JSON.stringify(tags));
    check('the tags filter narrows the listing and descends into sequences', Array.isArray(tags.filtered) && tags.filtered.includes('ImagePositionPatient') && !tags.filtered.includes('PatientName') && tags.deep.includes('ReferencedImageSequence'), JSON.stringify(tags));
    check("the tags pane wears the slice's modality as its hue", tags.hue === 'MR', JSON.stringify(tags));
  }
  }
  if (stage('image-annotations')) {
  if (dicomSeries === '' || !(await evalIn(`return document.querySelector('.pane-image') !== null;`))) {
    console.log('  skipped: needs the image pane from image-pane');
  } else {
    // A length drawn through the debugger, as the operator's would arrive.
    const at = await evalIn(`
      await console_idle();
      const input = document.querySelector('#terminal input');
      const run = async (line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300); };
      await run('image layout single');
      const image = document.querySelector('.pane-image');
      for (let i = 0; i < 40 && !image.querySelector('.image-viewport-stack'); i++) await sleep(150);
      image.querySelector('.image-tool[data-tool="length"]').click(); await sleep(200);
      const r = image.querySelector('.image-viewport').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
    await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x - 40, y: at.y - 40, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 40 + i * 10, y: at.y - 40 + i * 10, button: 'left' }); await new Promise((r) => setTimeout(r, 40)); }
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 40, y: at.y + 40, button: 'left', clickCount: 1 });
    const saved = await evalIn(`
      await sleep(600);
      const input = document.querySelector('#terminal input');
      const run = async (line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300); };
      await run('image save');
      let landed = null;
      for (let i = 0; i < 60; i++) { await sleep(300); landed = document.getElementById('terminal').innerText.split('\\n').find((l) => /^✓ \\/home\\/.*\\/annotations\\/.*measurements\\.dcm$/.test(l.trim())); if (landed) break; }
      if (!landed) return { error: 'nothing landed', tail: document.getElementById('terminal').innerText.split('\\n').slice(-4) };
      const file = landed.trim().slice(2);
      // Reopen the series: the file the kernel now lists comes back onto the field.
      const before = document.querySelector('.pane-image').dataset.annotations ?? null;
      await run('image ${dicomSeries}');
      let reloaded = null;
      for (let i = 0; i < 80; i++) { await sleep(300); reloaded = document.getElementById('terminal').innerText.split('\\n').find((l) => /^image: \\d+ measurements? from measurements\\.dcm/.test(l.trim())); if (reloaded) break; }
      const placed = document.querySelector('.pane-image').dataset.annotations ?? null;
      // Leave the identity's CFS as it was found.
      await run('rm -r ' + file.slice(0, file.lastIndexOf('/')));
      await sleep(1500);
      return { file, before, reloaded, placed };`);
    check('a measurement saved as an SR comes back when the series reopens', saved.error === undefined && /measurements\.dcm$/.test(saved.file ?? '') && saved.before === '0' && saved.placed === '1', JSON.stringify(saved));
  }
  }
  if (stage('image-guard')) {
  if (dicomSeries === '' || !(await evalIn(`return document.querySelector('.pane-image') !== null;`))) {
    console.log('  skipped: needs the image pane from image-pane');
  } else {
    const guard = await evalIn(`
      await console_idle();
      const image = document.querySelector('.pane-image');
      const input = document.querySelector('#terminal input');
      const run = async (line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300); };
      await run('image layout single');
      for (let i = 0; i < 40 && !image.querySelector('.image-viewport-stack'); i++) await sleep(150);
      const fetches = () => performance.getEntriesByType('resource').filter((e) => e.name.includes('/vfs?')).length;
      await run('image guard 1000');
      const before = fetches();
      await run('image layout mpr');
      await sleep(1500);
      const state = image.querySelector('.pane-state').textContent;
      const mode = image.querySelector('.pane-mode').textContent;
      const loadShown = !image.querySelector('.image-load').hidden;
      const during = fetches();
      await run('image load');
      let planes = 0;
      for (let i = 0; i < 80; i++) { await sleep(250); planes = image.querySelectorAll('.image-mpr .image-viewport').length; if (planes === 3 && image.querySelector('.pane-mode').textContent === 'MPR') break; }
      const loadHidden = image.querySelector('.image-load').hidden;
      await run('image guard off');
      await run('image layout single');
      await sleep(1500);
      return { state, mode, loadShown, fetched: during - before, planes, loadHidden };`);
    check('a volume layout over the guard waits for LOAD and fetches nothing', /^SERIES .* · LOAD FOR MPR$/.test(guard.state ?? '') && guard.mode === '' && guard.loadShown === true && guard.fetched === 0, JSON.stringify(guard));
    check('LOAD consents and the waiting layout follows', guard.planes === 3 && guard.loadHidden === true, JSON.stringify(guard));
  }
  }
  if (stage('image-volume')) {
  if (niftiPath === '') {
    console.log('  skipped: set SMOKE_NIFTI=<volume path on the daemon>');
  } else {
    const volume = await evalIn(`
      await console_idle();
      const input = document.querySelector('#terminal input');
      input.value = 'image ${niftiPath}';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      let image = null; let drawn = false;
      for (let i = 0; i < 120; i++) { await sleep(500); drawn = document.getElementById('terminal').innerText.includes('drawn in'); image = [...document.querySelectorAll('.pane-image')].find((p) => p.dataset.modality === 'NIFTI'); if (drawn && image) break; }
      if (!image) return { error: 'no NIFTI pane' };
      const canvas = image.querySelector('.image-canvas');
      const field = image.querySelector('.image-field').getBoundingClientRect();
      const c = canvas ? canvas.getBoundingClientRect() : null;
      return { drawn, fits: c !== null && Math.abs(c.width - field.width) < 4, state: image.querySelector('.pane-state').textContent };`);
    check('image <volume> opens a NIfTI on the same pane kind and says when it drew', volume.error === undefined && volume.drawn === true && volume.fits === true, JSON.stringify(volume));
  }
  }
  if (fixtureFolder !== null) {
    // The identity's CFS is left as it was found.
    await evalIn(`
      await console_idle();
      const input = document.querySelector('#terminal input');
      input.value = 'rm -r ${fixtureFolder}'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      for (let i = 0; i < 40; i++) { await sleep(250); if (document.getElementById('terminal').innerText.includes('Removed dir: ${fixtureFolder}')) return; }`);
    console.log(`  fixtures: removed ${fixtureFolder}`);
  }
} finally {
  stage_close();
  page.close();
}

// The three slowest scenarios, named. A suite this expensive should say
// where its minutes went rather than leaving it to be guessed at.
const slowest = [...timings].sort((a, b) => b[1] - a[1]).slice(0, 3);
const spent = timings.reduce((total, [, ms]) => total + ms, 0);
console.log(`\n${Math.round(spent / 1000)}s in ${timings.length} scenario(s)`
  + ` — slowest: ${slowest.map(([name, ms]) => `${name} ${Math.round(ms / 1000)}s`).join(', ')}`);
console.log(`\n${passes} ok, ${failures.length} failed${failures.length ? `: ${failures.join('; ')}` : ''}`);
process.exit(failures.length === 0 ? 0 : 1);
