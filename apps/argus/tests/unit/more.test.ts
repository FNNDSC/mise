/**
 * @jest-environment jsdom
 */
/**
 * @file A field that holds more than it shows says so: the chip's words,
 * its counts in rows and in lines, and its standing at the field's foot.
 */
import { describe, it, expect } from '@jest/globals';
import { more_wire, moreLabel_default, linesBelow_count, rowsBelow_count } from '../../src/features/roster/more.js';

/** jsdom lays nothing out: a field is given its geometry by hand. */
const field_make = (scrollHeight: number, clientHeight: number, scrollTop: number = 0): HTMLElement => {
  const field: HTMLElement = document.createElement('div');
  Object.defineProperty(field, 'scrollHeight', { get: (): number => scrollHeight, configurable: true });
  Object.defineProperty(field, 'clientHeight', { get: (): number => clientHeight, configurable: true });
  Object.defineProperty(field, 'scrollTop', { get: (): number => scrollTop, set: (): void => undefined, configurable: true });
  field.style.lineHeight = '20px';
  return field;
};

describe('a field says it holds more', () => {
  it('reads ▼ N MORE below the view and ▲ TOP at the foot', () => {
    expect(moreLabel_default(7, false)).toBe('▼ 7 MORE');
    expect(moreLabel_default(0, true)).toBe('▲ TOP');
  });

  it('counts the lines of text that lie below the view', () => {
    expect(linesBelow_count(field_make(1000, 200, 0))).toBe(40);
    expect(linesBelow_count(field_make(1000, 200, 790))).toBe(1);
    expect(linesBelow_count(field_make(100, 200, 0))).toBe(0);
  });

  it('counts the rows that start at or below the foot', () => {
    const field: HTMLElement = field_make(1000, 200);
    field.getBoundingClientRect = (): DOMRect => ({ bottom: 200, top: 0, left: 0, right: 100, width: 100, height: 200, x: 0, y: 0, toJSON: (): unknown => ({}) });
    for (const top of [10, 150, 199, 210, 400]) {
      const row: HTMLElement = document.createElement('div');
      row.className = 'listing-row';
      row.getBoundingClientRect = (): DOMRect => ({ top, bottom: top + 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: (): unknown => ({}) });
      field.appendChild(row);
    }
    expect(rowsBelow_count(field, '.listing-row')).toBe(3);
  });

  it('mints the chip at the field\'s foot, hidden while everything is in view, wearing the names given', () => {
    const field: HTMLElement = field_make(100, 200);
    document.body.appendChild(field);
    const chip: HTMLButtonElement = more_wire(field, { className: 'frame-more' });
    expect(field.classList.contains('holds-more')).toBe(true);
    expect(field.dataset['more']).toBe('wired');
    expect(chip.className).toBe('more-chip frame-more');
    expect(chip.hidden).toBe(true);
    expect(field.lastElementChild).toBe(chip);
  });

  it('shows the chip with the field\'s own words when content lies below, and a press does what it was given', () => {
    const field: HTMLElement = field_make(1000, 200, 0);
    document.body.appendChild(field);
    let pressed: number = 0;
    const chip: HTMLButtonElement = more_wire(field, { label: (below: number): string => `+${below} MORE · ON STAGE`, press: (): void => { pressed += 1; } });
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('+40 MORE · ON STAGE');
    chip.click();
    expect(pressed).toBe(1);
  });
});
