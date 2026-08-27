/**
 * @file Tests that indeterminate progress leaves the engine as typed facts.
 *
 * The point of the type is that no surface has to recover meaning from cursor
 * movement, so the assertions here are about what crosses the sink: events
 * carrying an operation, a phase and a label, and no terminal choreography at
 * all. State changes only — a spin of any length must cost the wire the same
 * two events as a spin of one tick.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ProgressEvent } from '../src/core/progress.js';
import { Spinner } from '../src/lib/spinner.js';
import { sink_set, StdoutSink } from '../src/core/sink.js';

const events: ProgressEvent[] = [];
const statusWrites: string[] = [];

class RecordingSink extends StdoutSink {
  public override progress_write(event: ProgressEvent): void {
    events.push(event);
  }

  public override status_write(text: string): void {
    statusWrites.push(text);
  }

  public override data_write(): void {}
  public override err_write(): void {}
}

describe('Spinner', () => {
  beforeEach(() => {
    events.length = 0;
    statusWrites.length = 0;
    sink_set(new RecordingSink());
  });

  it('announces indeterminate progress rather than drawing it', () => {
    const spinner: Spinner = new Spinner();
    spinner.start('Querying PACS…');
    spinner.stop();

    expect(events).toEqual([
      { operation: 'task', kind: 'inspection', phase: 'working', label: 'Querying PACS…' },
      { operation: 'task', kind: 'inspection', phase: 'complete', label: 'Querying PACS…' },
    ]);
    expect(statusWrites).toEqual([]);
  });

  it('writes no terminal escapes or carriage returns', () => {
    const spinner: Spinner = new Spinner();
    spinner.start('Scanning');
    spinner.updateMessage('Scanning /home');
    spinner.stop();

    const text: string = JSON.stringify(events);
    expect(text).not.toMatch(/\\u001b|\\r/);
  });

  it('emits one event per state change, not per animation frame', () => {
    const spinner: Spinner = new Spinner();
    spinner.start('Working');
    spinner.updateMessage('Working harder');
    spinner.stop();

    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ phase: 'working', label: 'Working harder' });
  });

  it('ignores a label revision while no announcement is open', () => {
    const spinner: Spinner = new Spinner();
    spinner.updateMessage('nobody is listening');

    expect(events).toEqual([]);
  });

  it('closes an open announcement before opening another', () => {
    const spinner: Spinner = new Spinner();
    spinner.start('First');
    spinner.start('Second');

    expect(events.map((event: ProgressEvent): string => `${event.phase}:${event.label}`)).toEqual([
      'working:First',
      'complete:First',
      'working:Second',
    ]);
  });

  it('closes only once, so a repeated stop announces nothing', () => {
    const spinner: Spinner = new Spinner();
    spinner.start('Once');
    spinner.stop();
    spinner.stop();

    expect(events.filter((event: ProgressEvent): boolean => event.phase === 'complete')).toHaveLength(1);
  });

  it('announces regardless of whether the engine host owns a terminal', () => {
    // Whether waiting can be shown is the renderer's question, not the
    // engine's: inside the daemon stdout is not a TTY, yet an attached
    // surface may well be able to draw.
    const descriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    try {
      new Spinner().start('Headless work');
      expect(events).toHaveLength(1);
    } finally {
      if (descriptor) {
        Object.defineProperty(process.stdout, 'isTTY', descriptor);
      }
    }
  });
});
