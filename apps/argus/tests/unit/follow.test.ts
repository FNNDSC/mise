/**
 * @file A hand pick holds against a follow it superseded: the follow's late
 * answer is dropped, once, and only while another feed is pinned.
 */
import { describe, it, expect } from '@jest/globals';
import { FollowGuard } from '../../src/features/dag/follow.js';

describe('FollowGuard', () => {
  it('drops the superseded follow\'s late answer while the pick holds, once', () => {
    const guard = new FollowGuard();
    guard.pick(21, 134);
    expect(guard.drops(134, 134)).toBe(false);
    expect(guard.drops(21, 134)).toBe(true);
    expect(guard.drops(21, 134)).toBe(false);
  });

  it('drops nothing when no follow was awaited, or the pick is the followed feed', () => {
    const none = new FollowGuard();
    none.pick(null, 134);
    expect(none.drops(21, 134)).toBe(false);
    const same = new FollowGuard();
    same.pick(134, 134);
    expect(same.drops(134, 134)).toBe(false);
  });

  it('lets the answer through once nothing is pinned', () => {
    const guard = new FollowGuard();
    guard.pick(21, 134);
    expect(guard.drops(21, null)).toBe(false);
  });
});
