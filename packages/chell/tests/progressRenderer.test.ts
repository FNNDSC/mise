import { describe, it, expect, beforeEach } from '@jest/globals';
import { TerminalProgressRenderer, type ProgressBarFactory } from '../src/core/progressRenderer.js';

class FakeBar {
  public updates: Array<{ value: number; payload?: Record<string, string> }> = [];
  public totals: number[] = [];
  public stopped: boolean = false;

  public start(total: number, startValue: number, payload?: Record<string, string>): void {
    this.totals.push(total);
    this.updates.push({ value: startValue, payload });
  }

  public update(value: number, payload?: Record<string, string>): void {
    this.updates.push({ value, payload });
  }

  public setTotal(total: number): void {
    this.totals.push(total);
  }

  public stop(): void {
    this.stopped = true;
  }
}

class FakeMultiBar {
  public static instances: FakeMultiBar[] = [];
  public bars: FakeBar[] = [];
  public stopped: boolean = false;

  constructor() {
    FakeMultiBar.instances.push(this);
  }

  public create(total: number, startValue: number, payload?: Record<string, string>): FakeBar {
    const bar = new FakeBar();
    bar.start(total, startValue, payload);
    this.bars.push(bar);
    return bar;
  }

  public remove(_bar: FakeBar): void { /* not used */ }

  public stop(): void {
    this.stopped = true;
  }
}

const singleBars: FakeBar[] = [];
class FakeSingleBar extends FakeBar {
  constructor() {
    super();
    singleBars.push(this);
  }
}

function fakeFactory_create(): ProgressBarFactory {
  return {
    SingleBar: FakeSingleBar as unknown as ProgressBarFactory['SingleBar'],
    MultiBar: FakeMultiBar as unknown as ProgressBarFactory['MultiBar'],
    preset: {},
  };
}

function stream_create(isTTY: boolean): NodeJS.WriteStream & { writes: string[] } {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write: (chunk: string | Uint8Array): boolean => {
      writes.push(chunk.toString());
      return true;
    },
  } as NodeJS.WriteStream & { writes: string[] };
}

beforeEach(() => {
  singleBars.length = 0;
  FakeMultiBar.instances.length = 0;
});

describe('TerminalProgressRenderer', () => {
  it('uses a single TTY bar for upload and stops it on complete', () => {
    const stream = stream_create(true);
    const renderer = new TerminalProgressRenderer({ stream, isTTY: true, factory: fakeFactory_create() });

    renderer.write({ operation: 'upload', phase: 'transferring', label: 'Uploading files', current: 0, total: 2, unit: 'files', status: 'running' });
    renderer.write({ operation: 'upload', phase: 'transferring', label: 'Uploading files', current: 1, total: 2, unit: 'files', status: 'running' });
    renderer.write({ operation: 'upload', phase: 'complete', label: 'Upload complete', current: 2, total: 2, unit: 'files', status: 'done' });

    expect(singleBars).toHaveLength(1);
    expect(singleBars[0].updates).toEqual([
      { value: 0, payload: { label: 'Uploading files', unit: 'files' } },
      { value: 1, payload: { label: 'Uploading files', unit: 'files' } },
      { value: 2, payload: { label: 'Upload complete [DONE]', unit: 'files' } },
    ]);
    expect(singleBars[0].stopped).toBe(true);
    expect(stream.writes).toEqual([]);
  });

  it('uses pull multibar entries keyed by itemId and renders unconfirmed as warning text', () => {
    const renderer = new TerminalProgressRenderer({ stream: stream_create(true), isTTY: true, factory: fakeFactory_create() });

    renderer.write({ operation: 'pull', kind: 'retrieve', phase: 'watching', itemId: 'series-a', label: 'T1', current: 1, total: 3, unit: 'files', status: 'running' });
    renderer.write({ operation: 'pull', kind: 'retrieve', phase: 'watching', itemId: 'series-b', label: 'T2', current: 0, total: 5, unit: 'files', status: 'running' });
    renderer.write({ operation: 'pull', kind: 'retrieve', phase: 'watching', itemId: 'series-a', label: 'T1', current: 3, total: 3, unit: 'files', status: 'unconfirmed' });

    expect(FakeMultiBar.instances).toHaveLength(1);
    expect(FakeMultiBar.instances[0].bars).toHaveLength(2);
    expect(FakeMultiBar.instances[0].bars[0].updates.at(-1)).toEqual({
      value: 3,
      payload: { label: 'T1 [UNCONFIRMED]', unit: 'files' },
    });
  });

  it('stops the pull multibar on aggregate completion', () => {
    const renderer = new TerminalProgressRenderer({ stream: stream_create(true), isTTY: true, factory: fakeFactory_create() });

    renderer.write({ operation: 'pull', phase: 'watching', itemId: 'series-a', label: 'T1', current: 1, total: 1, unit: 'files', status: 'done' });
    renderer.write({ operation: 'pull', phase: 'complete', label: 'Pull complete', current: 1, total: 1, unit: 'series', status: 'done' });

    expect(FakeMultiBar.instances[0].stopped).toBe(true);
  });

  it('does not stop the pull multibar for terminal per-item updates', () => {
    const renderer = new TerminalProgressRenderer({ stream: stream_create(true), isTTY: true, factory: fakeFactory_create() });

    renderer.write({ operation: 'pull', phase: 'watching', itemId: 'series-a', label: 'T1', current: 0, total: 1, unit: 'files', status: 'running' });
    renderer.write({ operation: 'pull', phase: 'failed', itemId: 'series-a', label: 'T1', current: 1, total: 1, unit: 'files', status: 'error' });

    expect(FakeMultiBar.instances[0].stopped).toBe(false);
    expect(FakeMultiBar.instances[0].bars[0].updates.at(-1)).toEqual({
      value: 1,
      payload: { label: 'T1 [ERROR]', unit: 'files' },
    });
  });

  it('non-TTY suppresses running progress and prints terminal events only', () => {
    const stream = stream_create(false);
    const renderer = new TerminalProgressRenderer({ stream, isTTY: false, factory: fakeFactory_create() });

    renderer.write({ operation: 'download', phase: 'transferring', label: 'Downloading files', current: 1, total: 3, unit: 'files', status: 'running' });
    renderer.write({ operation: 'download', phase: 'failed', label: 'Download complete', current: 1, total: 3, unit: 'files', status: 'error' });
    renderer.write({ operation: 'pull', phase: 'watching', label: 'T1', current: 0, total: 1, unit: 'files', status: 'unconfirmed' });

    expect(singleBars).toHaveLength(0);
    expect(stream.writes).toEqual([
      'download Download complete error 1/3 files\n',
      'pull T1 unconfirmed 0/1 files\n',
    ]);
  });

  it('clear stops active bars', () => {
    const renderer = new TerminalProgressRenderer({ stream: stream_create(true), isTTY: true, factory: fakeFactory_create() });
    renderer.write({ operation: 'upload', phase: 'transferring', current: 0, total: 1, unit: 'files' });
    renderer.write({ operation: 'pull', phase: 'watching', itemId: 'series-a', current: 0, total: 1, unit: 'files' });

    renderer.clear();

    expect(singleBars[0].stopped).toBe(true);
    expect(FakeMultiBar.instances[0].stopped).toBe(true);
  });
});
