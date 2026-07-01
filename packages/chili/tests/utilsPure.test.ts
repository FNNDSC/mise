/**
 * Tests for the pure chili utils: sort and input-format detection, plus the
 * TTY-gated confirmation prompt.
 */
jest.mock('readline');

import readline from 'readline';
import { items_sort, list_applySort } from '../src/utils/sort';
import {
  input_detectFormat,
  PluginInputFormat,
  pluginNameAndVersion_extractFromImage,
  pluginName_extractFromImage,
  prompt_confirmOrThrow,
} from '../src/utils/input_format';

describe('items_sort', () => {
  it('returns input unchanged with no sort field or empty list', () => {
    const items = [{ a: 2 }, { a: 1 }];
    expect(items_sort(items)).toBe(items);
    expect(items_sort([], 'a')).toEqual([]);
  });

  it('sorts numbers, strings and dates', () => {
    expect(items_sort([{ n: 3 }, { n: 1 }, { n: 2 }], 'n').map((i) => i.n)).toEqual([1, 2, 3]);
    expect(items_sort([{ s: 'b' }, { s: 'a' }], 's').map((i) => i.s)).toEqual(['a', 'b']);
    const d1 = new Date(1), d2 = new Date(2);
    expect(items_sort([{ d: d2 }, { d: d1 }], 'd').map((i) => i.d)).toEqual([d1, d2]);
  });

  it('reverses when requested', () => {
    expect(items_sort([{ n: 1 }, { n: 2 }], 'n', true).map((i) => i.n)).toEqual([2, 1]);
  });

  it('pushes null/undefined values to the end', () => {
    const out = items_sort([{ v: undefined }, { v: 'a' }], 'v');
    expect(out[0].v).toBe('a');
  });

  it('falls back to string comparison for mixed types', () => {
    const out = items_sort([{ v: 10 }, { v: 'x' }], 'v');
    expect(out).toHaveLength(2);
  });
});

describe('list_applySort', () => {
  it('returns items unchanged when no field given', () => {
    const items = [{ a: 2 }, { a: 1 }];
    expect(list_applySort(items)).toBe(items);
  });
  it('sorts when a field is given', () => {
    expect(list_applySort([{ a: 2 }, { a: 1 }], 'a').map((i) => i.a)).toEqual([1, 2]);
  });
});

describe('input_detectFormat', () => {
  it('detects a store URL', () => {
    const d = input_detectFormat('  https://cube.org/api/v1/  ');
    expect(d.format).toBe(PluginInputFormat.STORE_URL);
    expect(d.value).toBe('https://cube.org/api/v1/');
  });
  it('detects a docker image with name + version', () => {
    const d = input_detectFormat('fnndsc/pl-dircopy:2.1.1');
    expect(d).toMatchObject({ format: PluginInputFormat.DOCKER_IMAGE, pluginName: 'pl-dircopy', version: '2.1.1' });
  });
  it('detects a plugin name with -v version', () => {
    const d = input_detectFormat('pl-dircopy-v2.1.1');
    expect(d).toMatchObject({ format: PluginInputFormat.PLUGIN_NAME, pluginName: 'pl-dircopy', version: '2.1.1' });
  });
  it('detects a plain plugin name', () => {
    expect(input_detectFormat('pl-dircopy')).toEqual({ format: PluginInputFormat.PLUGIN_NAME, value: 'pl-dircopy' });
  });
});

describe('pluginNameAndVersion_extractFromImage', () => {
  it.each([
    ['fnndsc/pl-dircopy:2.1.1', 'pl-dircopy', '2.1.1'],
    ['fnndsc/pl-dircopy', 'pl-dircopy', undefined],
    ['pl-dircopy:latest', 'pl-dircopy', 'latest'],
  ])('%s', (img, name, version) => {
    expect(pluginNameAndVersion_extractFromImage(img)).toEqual({ name, version });
  });
  it('pluginName_extractFromImage returns just the name', () => {
    expect(pluginName_extractFromImage('fnndsc/pl-x:1.0')).toBe('pl-x');
  });
});

describe('prompt_confirmOrThrow', () => {
  const origTTY = process.stdout.isTTY;
  afterEach(() => {
    process.stdout.isTTY = origTTY;
    jest.clearAllMocks();
  });

  it('throws in a non-TTY environment', async () => {
    process.stdout.isTTY = false;
    await expect(prompt_confirmOrThrow('Proceed?')).rejects.toThrow('--force');
  });

  it('resolves when the user confirms', async () => {
    process.stdout.isTTY = true;
    (readline.createInterface as jest.Mock).mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb('y'),
      close: jest.fn(),
    });
    await expect(prompt_confirmOrThrow('Proceed?')).resolves.toBeUndefined();
  });

  it('throws when the user declines', async () => {
    process.stdout.isTTY = true;
    (readline.createInterface as jest.Mock).mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb('n'),
      close: jest.fn(),
    });
    await expect(prompt_confirmOrThrow('Proceed?')).rejects.toThrow('cancelled');
  });
});
