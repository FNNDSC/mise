/**
 * @file Headless CDP driver for the argus smoke suite.
 *
 * Launches chromium against a live argus (daemon URL from ARGUS_URL or the
 * calypso attach file), evaluates expressions in the page, and captures
 * screenshots. No frameworks: chromium + the repo's own ws client.
 */
import { WebSocket } from 'ws';
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';

const DEBUG_PORT = Number(process.env.SMOKE_CDP_PORT ?? 9345);

/** Reads the argus URL: $ARGUS_URL, else the user's calypso attach file. */
export function argusUrl_discover() {
  if (process.env.ARGUS_URL) return process.env.ARGUS_URL;
  const attach = readFileSync(`/tmp/calypso-${os.userInfo().username}.attach`, 'utf8');
  const line = attach.split('\n').find((l) => l.startsWith('ARGUS:'));
  if (!line) throw new Error('no ARGUS line in attach file; set ARGUS_URL');
  // Loopback dodges hostname-hijacking proxies.
  return line.replace('ARGUS:', '').trim().replace(/\/\/[^:/]+:/, '//127.0.0.1:');
}

/** Boots chromium, navigates, and returns an evaluate/screenshot handle. */
export async function page_open(url) {
  const chrome = spawn('chromium', [
    '--headless=new', '--no-proxy-server', '--disable-gpu',
    `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=2560,1440',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const list = JSON.parse(
    execSync(`curl -s --noproxy "*" http://127.0.0.1:${DEBUG_PORT}/json`).toString(),
  );
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  // SMOKE_DPR emulates a HiDPI display (a real desktop at 1.25–2×): canvas
  // sizing bugs hide at the headless default of 1.
  const dpr = Number(process.env.SMOKE_DPR ?? '1');
  if (dpr !== 1) {
    await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: dpr, mobile: false });
  }
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 4000));
  return {
    /** Evaluates an async expression body; returns its JSON value. */
    eval: async (expression) => {
      const out = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (out?.exceptionDetails) throw new Error(out.exceptionDetails.text);
      return out?.result?.value;
    },
    shot: async (path) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, Buffer.from(shot.data, 'base64'));
    },
    /** Raw CDP access for probes. */
    cdp: send,
    close: () => { try { chrome.kill(); } catch { /* gone */ } },
  };
}
