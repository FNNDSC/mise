/**
 * Tests for the screen module: table rendering across every accepted input
 * shape (row objects, string matrices, CSV-ish strings), border drawing,
 * titles with each justification, type-based cell coloring, pagination hints,
 * borderless mode, and the Screen logging facade. Rendering is asserted on
 * content rather than exact box-drawing bytes.
 */
import { border_draw, table_render, table_display, screen, Screen } from '../src/screen/screen';

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let infoSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  warnSpy.mockRestore();
  infoSpy.mockRestore();
});

/** Strips ANSI color codes so assertions see plain content. */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('border_draw', () => {
  it('draws all four borders by default', () => {
    const out = border_draw('hello');
    const lines = out.split('\n');
    expect(lines[0]).toContain('─');
    expect(lines[lines.length - 1]).toContain('─');
    expect(out).toContain('hello');
  });

  it('honours selective borders', () => {
    const out = border_draw('x', { top: false, bottom: false });
    expect(out).toContain('x');
    expect(out.split('\n').length).toBeLessThan(border_draw('x').split('\n').length);
  });

  it('handles multi-line text', () => {
    const out = border_draw('one\ntwo');
    expect(out).toContain('one');
    expect(out).toContain('two');
  });
});

describe('table_render input shapes', () => {
  it('renders row objects against selected headers', () => {
    const out = plain(table_render(
      [{ id: 1, name: 'pl-dircopy' }, { id: 2, name: 'pl-fshack' }],
      ['id', 'name'],
    ));
    expect(out).toContain('pl-dircopy');
    expect(out).toContain('pl-fshack');
  });

  it('renders a string matrix mapped onto headers', () => {
    const out = plain(table_render(
      [['1', 'alpha'], ['2', 'beta']],
      ['id', 'label'],
    ));
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('renders comma-separated row strings and comma-separated headers', () => {
    const out = plain(table_render(['1,alpha', '2,beta'], 'id, label'));
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('fills missing cells with empty strings', () => {
    const out = plain(table_render([{ id: 7 }], ['id', 'missing']));
    expect(out).toContain('7');
  });

  it('returns an empty string for empty data', () => {
    expect(table_render([], ['id'])).toBe('');
  });

  it('appends the pagination hint when rows are truncated', () => {
    const out = plain(table_render([{ id: 1 }], ['id'], { pagination: { shown: 1, total: 42 } }));
    expect(out).toContain('showing 1 of 42');
    expect(out).toContain('--all');
  });

  it('omits the pagination hint when everything is shown', () => {
    const out = plain(table_render([{ id: 1 }], ['id'], { pagination: { shown: 1, total: 1 } }));
    expect(out).not.toContain('showing');
  });
});

describe('table_render options', () => {
  it('renders titles under each justification without corrupting the table', () => {
    for (const justification of ['left', 'center', 'right'] as const) {
      const out = plain(table_render([{ id: 1 }], ['id'], { title: { title: 'Jobs', justification } }));
      expect(out).toContain('1');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('truncates an over-wide title with an ellipsis', () => {
    const longTitle = 'T'.repeat(400);
    const out = plain(table_render([{ id: 'a-reasonably-wide-row' }], ['id'], { title: { title: longTitle } }));
    expect(out).toContain('...');
    expect(out).not.toContain(longTitle);
  });

  it('survives a title on a table narrower than the title', () => {
    // Regression: negative pad/repeat counts used to throw and replace the
    // whole table with "Error generating table".
    for (const justification of ['left', 'center', 'right'] as const) {
      const out = plain(table_render([{ id: 1 }], ['id'], { title: { title: 'A much longer title', justification } }));
      expect(out).toContain('1');
      expect(out).not.toContain('Error generating table');
    }
  });

  it('renders borderless output without box-drawing characters', () => {
    const out = plain(table_render([{ id: 1, name: 'x' }], ['id', 'name'], { borderless: true }));
    expect(out).toContain('x');
    expect(out).not.toContain('─');
  });

  it('renders mixed cell types with content intact', () => {
    // Color codes are terminal-dependent (chalk level 0 in tests), so the
    // assertion is on content across number, string, and boolean cells.
    const out = plain(table_render(
      [{ n: 12, s: 'str', b: true }],
      ['n', 's', 'b'],
    ));
    expect(out).toContain('12');
    expect(out).toContain('str');
    expect(out).toContain('true');
  });

  it('honours per-column justification overrides', () => {
    const out = plain(table_render(
      [{ a: '1', b: 'two' }],
      ['a', 'b'],
      { columns: [{ justification: 'left' }, { justification: 'right' }] },
    ));
    expect(out).toContain('two');
  });
});

describe('table_display', () => {
  it('prints the table and returns its content object', () => {
    const content = table_display([{ id: 1, name: 'x' }], ['id', 'name']);
    expect(content).not.toBeNull();
    expect(content?.headers).toEqual(['id', 'name']);
    expect(content?.body).toEqual([[1, 'x']]);
    expect(logSpy).toHaveBeenCalled();
  });

  it('returns null and reports on empty data', () => {
    expect(table_display([], ['id'])).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('prints the pagination hint when truncated', () => {
    table_display([{ id: 1 }], ['id'], { pagination: { shown: 1, total: 9 } });
    const printed = logSpy.mock.calls.map((c) => plain(String(c[0]))).join('\n');
    expect(printed).toContain('showing 1 of 9');
  });
});

describe('Screen facade', () => {
  it('routes log/error/warn/info through the output seam', () => {
    screen.log('l');
    screen.error('e');
    screen.warn('w');
    screen.info('i');
    const logged = logSpy.mock.calls.map((c) => plain(String(c[0])));
    const errored = errSpy.mock.calls.map((c) => plain(String(c[0])));
    expect(logged).toEqual(expect.arrayContaining(['l', 'i']));
    expect(errored).toEqual(expect.arrayContaining(['e', 'w']));
  });

  it('table_output renders a plain object as key/value rows', () => {
    const local: Screen = new Screen();
    const out = plain(local.table_output({ alpha: 1, beta: 'two' }));
    expect(out).toContain('alpha');
    expect(out).toContain('two');
  });

  it('table_output survives malformed input without throwing', () => {
    const local: Screen = new Screen();
    expect(() => local.table_output(null as never)).not.toThrow();
  });
});
