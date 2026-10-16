/**
 * @file The terminal's line discipline: typed-ahead lines wait in order and
 * are taken oldest first; output arriving on its own lands above the line
 * being typed, which is then drawn again.
 */
import { describe, it, expect, afterEach } from '@jest/globals';

const { typeahead_push, typeahead_take, typeahead_clear, typeahead_count, lineRedraw_set, output_above, question_openSet, question_isOpen } = await import('../src/core/lineDiscipline.js');

afterEach(() => {
  typeahead_clear();
  lineRedraw_set(null);
  question_openSet(false);
});

describe('line discipline', () => {
  it('keeps typed-ahead lines in order and hands them out oldest first', () => {
    typeahead_push('s');
    typeahead_push('n');
    expect(typeahead_count()).toBe(2);
    expect(typeahead_take()).toBe('s');
    expect(typeahead_take()).toBe('n');
    expect(typeahead_take()).toBeUndefined();
  });

  it('Ctrl-C forgets them', () => {
    typeahead_push('rm -r x');
    typeahead_clear();
    expect(typeahead_count()).toBe(0);
  });

  it('writes output above the line being typed, then redraws that line', () => {
    const written: string[] = [];
    let redrawn: number = 0;
    lineRedraw_set((): void => { redrawn++; });
    output_above('[surface ab12cd]\nfeed 7 pulled', (chunk: string): void => { written.push(chunk); });
    expect(written).toEqual(['\r\u001b[2K', '[surface ab12cd]\nfeed 7 pulled\n']);
    expect(redrawn).toBe(1);
  });

  it('with nothing drawn, output is written as it is', () => {
    const written: string[] = [];
    output_above('plain\n', (chunk: string): void => { written.push(chunk); });
    expect(written).toEqual(['plain\n']);
  });

  it('knows when a question is open', () => {
    expect(question_isOpen()).toBe(false);
    question_openSet(true);
    expect(question_isOpen()).toBe(true);
  });
});

describe('the terminal state mark', () => {
  it('is written only when this shell is a browser\'s terminal', async () => {
    const { terminalState_mark } = await import('../src/core/lineDiscipline.js');
    const written: string[] = [];
    const before: string | undefined = process.env['CHELL_TERMINAL'];
    try {
      delete process.env['CHELL_TERMINAL'];
      terminalState_mark('busy', (chunk: string): void => { written.push(chunk); });
      expect(written).toEqual([]);
      process.env['CHELL_TERMINAL'] = '0123456789abcdef01234567';
      terminalState_mark('asking', (chunk: string): void => { written.push(chunk); });
      expect(written).toEqual(['\u001b]6677;state=asking\u0007']);
    } finally {
      if (before === undefined) delete process.env['CHELL_TERMINAL'];
      else process.env['CHELL_TERMINAL'] = before;
    }
  });
});
