/**
 * @file The download ledger: a held file is let go when the save never
 * comes, and finished downloads are forgotten in time.
 */
import { Readable } from 'node:stream';
import { DownloadLedger, downloadId_valid } from '../src/daemon/downloads';

describe('DownloadLedger', () => {
  it('lets a held file go when the browser never comes for it', async () => {
    const ledger = new DownloadLedger(Date.now, 10);
    const stream = Readable.from([Buffer.from('x')]);
    ledger.begin('held01', '/f');
    ledger.park('held01', { stream, size: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ledger.report('held01')).toMatchObject({ phase: 'failed', reason: 'the browser never came for the file' });
    expect(stream.destroyed).toBe(true);
    expect(ledger.claim('held01')).toBeNull();
  });

  it('forgets a finished download after its keep', () => {
    let now = 1_000;
    const ledger = new DownloadLedger(() => now, 60_000, 100);
    ledger.begin('old001', '/a');
    ledger.fail('old001', 'nope');
    now += 500;
    ledger.begin('new001', '/b');
    expect(ledger.report('old001')).toBeNull();
    expect(ledger.report('new001')).toMatchObject({ phase: 'opening', elapsedMs: 0 });
  });

  it('a download cancelled while CUBE answers stays cancelled: nothing is held', () => {
    const ledger = new DownloadLedger();
    const stream = Readable.from([Buffer.from('x')]);
    ledger.begin('late01', '/f');
    expect(ledger.cancel('late01')).toBe(true);
    expect(ledger.park('late01', { stream, size: 1 })).toBe(false);
    expect(stream.destroyed).toBe(true);
    expect(ledger.cancelled('late01')).toBe(true);
    expect(ledger.report('late01')).toMatchObject({ phase: 'cancelled' });
  });

  it('takes only plain ids', () => {
    expect(downloadId_valid('dl-k3j4h5')).toBe(true);
    expect(downloadId_valid('../x')).toBe(false);
    expect(downloadId_valid(null)).toBe(false);
  });
});
