/**
 * @jest-environment jsdom
 *
 * @file A field answers its edges: a wheel or a finger pushing past the top
 * or the foot, or a scroll come to rest on one, says which edge was met
 * (`data-edge`) for the stylesheet to flare; a spinning wheel is one meeting;
 * the flare's end clears it; a field that does not overflow has no edges.
 */
import { describe, it, expect } from '@jest/globals';
import { edge_meet, EDGE_REST_MS, more_wire } from '../../src/features/roster/more.js';

/** A field whose geometry the test sets: 1000 tall content in a 200 tall view. */
function field_make(scrollTop: number, scrollHeight: number = 1000): HTMLElement {
  const field: HTMLElement = document.createElement('div');
  let top: number = scrollTop;
  Object.defineProperty(field, 'scrollHeight', { get: () => scrollHeight });
  Object.defineProperty(field, 'clientHeight', { get: () => 200 });
  Object.defineProperty(field, 'scrollTop', { get: () => top, set: (value: number) => { top = value; } });
  document.body.appendChild(field);
  more_wire(field);
  return field;
}

const wheel = (field: HTMLElement, deltaY: number): void => { field.dispatchEvent(new WheelEvent('wheel', { deltaY })); };
const touch = (field: HTMLElement, type: string, y: number): void => {
  const event = new Event(type) as Event & { touches: Array<{ clientY: number }> };
  Object.defineProperty(event, 'touches', { value: [{ clientY: y }] });
  field.dispatchEvent(event);
};

describe('a field meets its edges', () => {
  it('flares the foot when the wheel pushes past it, and the top when it pushes past the top', () => {
    const foot = field_make(800);
    wheel(foot, 40);
    expect(foot.dataset['edge']).toBe('bottom');
    const top = field_make(0);
    wheel(top, -40);
    expect(top.dataset['edge']).toBe('top');
    wheel(top, 40);
    expect(top.dataset['edge']).toBe('top');
  });

  it('does nothing in the middle, nor on a field that holds no more than it shows', () => {
    const middle = field_make(300);
    wheel(middle, 40);
    wheel(middle, -40);
    expect(middle.dataset['edge']).toBeUndefined();
    const short = field_make(0, 150);
    wheel(short, -40);
    expect(short.dataset['edge']).toBeUndefined();
  });

  it('flares an edge a finger pushes past, once per push', () => {
    const top = field_make(0);
    touch(top, 'touchstart', 100);
    touch(top, 'touchmove', 104);
    expect(top.dataset['edge']).toBeUndefined();
    touch(top, 'touchmove', 130);
    expect(top.dataset['edge']).toBe('top');
    const foot = field_make(800);
    touch(foot, 'touchstart', 300);
    touch(foot, 'touchmove', 250);
    expect(foot.dataset['edge']).toBe('bottom');
  });

  it('flares the edge a scroll comes to rest on, and not one it never left', () => {
    const field = field_make(300);
    field.scrollTop = 800;
    field.dispatchEvent(new Event('scrollend'));
    expect(field.dataset['edge']).toBe('bottom');
    delete field.dataset['edge'];
    field.dispatchEvent(new Event('scrollend'));
    expect(field.dataset['edge']).toBeUndefined();
  });

  it('is one meeting while the flare rests, a new one after, and the flare\'s end clears it', () => {
    const field = document.createElement('div');
    expect(edge_meet(field, 'bottom', 1000)).toBe(true);
    expect(edge_meet(field, 'bottom', 1000 + EDGE_REST_MS - 1)).toBe(false);
    expect(edge_meet(field, 'bottom', 1000 + EDGE_REST_MS)).toBe(true);
    expect(edge_meet(field, 'top', 1000 + EDGE_REST_MS + 1)).toBe(true);
    const wired = field_make(800);
    wheel(wired, 40);
    const end = new Event('animationend') as Event & { animationName: string };
    Object.defineProperty(end, 'animationName', { value: 'edge-flare-bottom' });
    wired.dispatchEvent(end);
    expect(wired.dataset['edge']).toBeUndefined();
  });
});
