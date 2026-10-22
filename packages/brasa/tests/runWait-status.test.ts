/**
 * @file How a run's settlement becomes the `status` a run model carries.
 */
import { describe, it, expect } from '@jest/globals';

const { settlementStatus_of } = await import('../src/builtins/res/runWait.js');

describe('settlementStatus_of', () => {
  it("is CUBE's word when the wait saw the run end", () => {
    expect(settlementStatus_of({ instanceIDs: [7], statuses: new Map([[7, 'finishedSuccessfully']]), outcome: 'settled', failed: 0, elapsedMs: 1 }, 7))
      .toBe('finishedSuccessfully');
  });

  it('is detached when the line let the run go before it ended', () => {
    expect(settlementStatus_of({ instanceIDs: [7], statuses: new Map([[7, 'started']]), outcome: 'detached', failed: 0, elapsedMs: 1 }, 7))
      .toBe('detached');
  });

  it('is the last word seen when CUBE stopped answering, and unknown when it never said', () => {
    expect(settlementStatus_of({ instanceIDs: [7], statuses: new Map([[7, 'started']]), outcome: 'unreachable', failed: 0, elapsedMs: 1 }, 7))
      .toBe('started');
    expect(settlementStatus_of({ instanceIDs: [7], statuses: new Map(), outcome: 'unreachable', failed: 0, elapsedMs: 1 }, 7))
      .toBe('unknown');
  });
});
