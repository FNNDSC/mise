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

  console.log('gutter-idempotency');
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

  console.log('zoom-completeness');
  const zoom = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(700);
    const pane = document.querySelector('.pane-files');
    pane.querySelector('.pane-handle').click(); await sleep(150);
    pane.querySelector('.drawer-zoom').click(); await sleep(700);
    const header = document.querySelector('.wrap:not(#gap)');
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
    strip.click(); await sleep(700);
    zoomed.stripRestored = header.getBoundingClientRect().bottom > 50;
    zoomed.capsuleAfter = pane.querySelector('.drawer-zoom').textContent;
    pane.querySelector('.drawer-zoom').click(); await sleep(700);
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
  check('zoom hides the lid and the status readouts', zoom.lidHidden && zoom.statusHidden);
  check('zoom leaves the thin restore strip, and it restores', zoom.stripShown && zoom.stripRestored);
  check('the capsule reads RESTORE while zoomed, ZOOM after', zoom.capsule === 'RESTORE' && zoom.capsuleAfter === 'ZOOM', `${zoom.capsule}/${zoom.capsuleAfter}`);
  check('Esc restores the header', zoom.restoredHeaderBottom > 50, `bottom=${zoom.restoredHeaderBottom}`);

  console.log('split-zoom');
  const splitZoom = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(600);
    const pane = document.querySelector('.pane-files');
    pane.querySelector('.pane-handle').click(); await sleep(150);
    pane.querySelector('[data-split="col"][data-place="after"]').click(); await sleep(600);
    const leaves = document.querySelectorAll('#layout-root .layout-leaf').length;
    pane.querySelector('.pane-handle').click(); await sleep(150);
    pane.querySelector('.drawer-zoom').click(); await sleep(900);
    const r = pane.closest('.layout-leaf').getBoundingClientRect();
    const full = r.width > window.innerWidth * 0.85;
    for (let i = 0; i < 3 && document.body.dataset.zoom !== undefined; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(600);
    }
    document.getElementById('gutter-files').click(); await sleep(400);
    return { leaves, full, w: Math.round(r.width) };`);
  check('a zoomed leaf inside a split conquers the whole region', splitZoom.leaves >= 2 && splitZoom.full, `leaves=${splitZoom.leaves} w=${splitZoom.w}`);

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

  console.log('console-grammar');
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

  console.log('focus-citizenship');
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

  console.log('census-pill');
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
    return { present: true, before, after, restored: pill.textContent === before, gBefore, gAfter, gRestored: g ? g.textContent === gBefore : false };`);
  check('CENSUS pill present, toggles SHAPE/CENSUS, restores', censusPill.present && censusPill.before === 'SHAPE' && censusPill.after === 'CENSUS' && censusPill.restored);
  check('GRAVITY pill reads its state and toggles', censusPill.gBefore === 'GRAVITY OFF' && censusPill.gAfter === 'GRAVITY ON' && censusPill.gRestored);

  console.log('bin-context');
  // /bin entries open as context: a plugin as its highlighted description,
  // a pipeline as its summary with its DAG rendered beneath.
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
    plugin.click();
    let desc = false;
    for (let i = 0; i < 40; i++) { await sleep(500); const c = fp.querySelector('.files-content'); if (c && /DESCRIPTION/.test(c.textContent)) { desc = true; break; } }
    const colored = fp.querySelectorAll('.files-content .man-head, .files-content span[style]').length > 0;
    // Esc is contextual back: the content view is a level above the listing
    // (the command line, if still open, is the topmost transient and would
    // take the press — close it first).
    if (!document.getElementById('lang-palette').hidden) { pill.click(); await sleep(150); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(400);
    const escBack = !fp.querySelector('.files-content') && fp.querySelectorAll('.files-row').length > 0;
    const pipeline = fp.querySelector('.files-row.files-type-pipeline');
    if (!pipeline) return { skipped: null, desc, colored, pipelineSkipped: true };
    pipeline.click();
    let summary = false, canvas = false;
    for (let i = 0; i < 60; i++) { await sleep(500); const c = fp.querySelector('.files-content'); if (c && /pipeline/.test(c.textContent)) summary = true; if (fp.querySelector('.files-diagram canvas')) { canvas = true; break; } }
    fp.querySelector('.files-close-pill')?.click(); await sleep(300);
    return { skipped: null, desc, colored, escBack, summary, canvas, pipelineSkipped: false };`);
  if (binCtx.skipped) {
    console.log(`  skipped: ${binCtx.skipped}`);
  } else {
    check('a plugin opens as its description', binCtx.desc && binCtx.colored);
    check('Esc returns a content view to its listing', binCtx.escBack === true);
    if (binCtx.pipelineSkipped) console.log('  skipped: no pipeline rows');
    else check('a pipeline opens as its summary with its DAG rendered', binCtx.summary && binCtx.canvas);
  }

  console.log('follow-declared');
  // The following browser says so on its bar, and the binding is a verb
  // both ways: ROOT HERE drops CWD from the bar, FOLLOW CWD brings it back.
  const follow = await evalIn(`
    document.getElementById('gutter-files').click(); await sleep(800);
    const fp = [...document.querySelectorAll('.pane-files')].find(p => p.offsetParent !== null);
    const state = () => fp.querySelector('.pane-state').textContent;
    const atLogin = state();
    const verb = async (label) => { fp.querySelector('.pane-handle').click(); await sleep(150); const cap = [...fp.querySelectorAll('.drawer-child')].find(c => c.textContent === label); if (!cap) return false; cap.click(); await sleep(400); return true; };
    const rooted = await verb('ROOT HERE'); const afterRoot = state();
    const followed = await verb('FOLLOW CWD'); await sleep(1500); const afterFollow = state();
    return { atLogin, rooted, afterRoot, followed, afterFollow };`);
  check('the following browser says CWD on its bar', /^CWD\b/.test(follow.atLogin));
  check('ROOT HERE and FOLLOW CWD re-bind the browser, and the bar follows', follow.rooted && !/^CWD\b/.test(follow.afterRoot) && follow.followed && /^CWD\b/.test(follow.afterFollow));

  console.log('select-wait');
  // Selecting a feed answers at once: the roster steps aside, the pane says
  // what it is retrieving, and the bar reads LOADING until the graph lands.
  const selectWait = await evalIn(`
    document.getElementById('gutter-runs').click();
    for (let i = 0; i < 60; i++) { await sleep(500); if (document.querySelector('.feedlist-row')) break; }
    const dp = document.querySelector('.pane-dag');
    const rows = dp.querySelectorAll('.feedlist-row');
    if (rows.length === 0) return { skipped: 'no roster' };
    rows[rows.length - 1].click();
    await sleep(30);
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
    check('selecting a feed answers at once', selectWait.atOnce.listHidden && selectWait.atOnce.retrieving && selectWait.atOnce.state === 'LOADING');
    check('the graph lands and LOADING clears', selectWait.landed && selectWait.stateAfter !== 'LOADING');
  }

  console.log('pin-survives');
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
    rows[rows.length - 1].click();
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

  console.log('enter-place');
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

  console.log('live-watch');
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
    const listBack = dp.querySelector('.dag-feedlist').style.display === 'block';
    const stateCleared = !/^(LIVE|SETTLED|STALE)$/.test(state.textContent.trim());
    return { skipped: text ? null : 'no watched report (daemon predates the watch wire?)', text, offered, after, listBack, stateCleared };`);
  if (live.skipped) {
    console.log(`  skipped: ${live.skipped}`);
  } else {
    check('entering a feed reports its liveness on the bar', /^(LIVE|SETTLED|STALE)$/.test(live.text));
    check('the drawer offers REFRESH and the state survives a refresh', live.offered && /^(LIVE|SETTLED|STALE)$/.test(live.after));
    check('leaving the feed releases the watch: list back, state cleared', live.listBack && live.stateCleared);
  }

  console.log('roster-order');
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
    fp.querySelector('.pane-handle').click(); await sleep(150);
    const filterCap = [...fp.querySelectorAll('.drawer-child')].find(c => c.textContent === 'FILTER');
    filterCap.click(); await sleep(200);
    const strip = !fp.querySelector('.roster-filter').hidden;
    const input = fp.querySelector('.roster-filter-input');
    input.value = 'zzzz-no-such-entry'; input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(250);
    const state = fp.querySelector('.pane-state').textContent;
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200);
    fp.querySelector('.pane-handle').click(); await sleep(100);
    return { caps, sorted: before !== after && before.length > 0, lit, strip, state };`);
  check('column caps sort the files listing (touch to sort, lit when active)', roster.caps >= 4 && roster.sorted && roster.lit, JSON.stringify(roster));
  check('FILTER summons the strip and the bar carries FILTERED n/m', roster.strip && /(^|· )FILTERED 0\//.test(roster.state), roster.state);

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
