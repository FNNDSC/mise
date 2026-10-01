/**
 * @jest-environment jsdom
 */
/**
 * @file A JSON file is shown as structure: pretty-printed, each token in a
 * span naming its kind; what is not JSON, or is too large to lay out, is
 * left as the bytes it is.
 */
import { describe, it, expect } from '@jest/globals';
import { JSON_FILE_PATTERN, jsonPretty_build } from '../../src/features/files/json.js';

const render = (text: string): HTMLElement | null => {
  const fragment: DocumentFragment | null = jsonPretty_build(text);
  if (fragment === null) return null;
  const host: HTMLElement = document.createElement('pre');
  host.append(fragment);
  return host;
};

describe('jsonPretty_build', () => {
  it('indents one minified line and marks keys, strings, numbers and literals apart', () => {
    const host: HTMLElement | null = render('{"name":"g","series":[{"uid":"1.2.3","files":30,"pulled":true,"feed":null}]}');
    expect(host).not.toBeNull();
    expect(host!.textContent).toBe(JSON.stringify(JSON.parse('{"name":"g","series":[{"uid":"1.2.3","files":30,"pulled":true,"feed":null}]}'), null, 2));
    expect([...host!.querySelectorAll('.json-key')].map((el) => el.textContent)).toEqual(['"name"', '"series"', '"uid"', '"files"', '"pulled"', '"feed"']);
    expect([...host!.querySelectorAll('.json-string')].map((el) => el.textContent)).toEqual(['"g"', '"1.2.3"']);
    expect([...host!.querySelectorAll('.json-number')].map((el) => el.textContent)).toEqual(['30']);
    expect([...host!.querySelectorAll('.json-literal')].map((el) => el.textContent)).toEqual(['true', 'null']);
  });

  it('keeps a string that holds a colon or an escaped quote as a value, not a key', () => {
    const host: HTMLElement | null = render('{"path":"/a:b","say":"he said \\"hi\\""}');
    expect([...host!.querySelectorAll('.json-key')].map((el) => el.textContent)).toEqual(['"path"', '"say"']);
    expect([...host!.querySelectorAll('.json-string')].map((el) => el.textContent)).toEqual(['"/a:b"', '"he said \\"hi\\""']);
  });

  it('answers null for text that is not JSON, and for JSON too large to lay out', () => {
    expect(jsonPretty_build('not json')).toBeNull();
    expect(jsonPretty_build('[1,')).toBeNull();
    expect(jsonPretty_build('[' + '1,'.repeat(3 * 1024 * 1024) + '1]')).toBeNull();
  });

  it('names a JSON file by its extension alone', () => {
    expect(JSON_FILE_PATTERN.test('/home/x/gather/current.json')).toBe(true);
    expect(JSON_FILE_PATTERN.test('/home/x/notes.JSON')).toBe(true);
    expect(JSON_FILE_PATTERN.test('/home/x/data.jsonl')).toBe(false);
  });
});
