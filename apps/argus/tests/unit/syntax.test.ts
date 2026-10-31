/**
 * @jest-environment jsdom
 */
/**
 * @file Source opened to read wears the editor's colours: each token a span
 * of its colour's class, the text itself unchanged. AsciiDoc, which the
 * library has no grammar for, is read a line at a time.
 */
import { describe, it, expect } from '@jest/globals';
import { sourceSpans_build } from '../../src/features/edit/syntax.js';

/** The coloured text laid into a host, with the spans' text by kind. */
const colour = async (text: string, extension: string): Promise<{ host: HTMLElement; coloured: string[] } | null> => {
  const fragment: DocumentFragment | null = await sourceSpans_build(text, extension);
  if (fragment === null) return null;
  const host: HTMLElement = document.createElement('pre');
  host.append(fragment);
  return { host, coloured: Array.from(host.querySelectorAll('span')).map((span) => span.textContent ?? '') };
};

describe('sourceSpans_build', () => {
  it('colours AsciiDoc headings, attributes, delimiters, listings, lists and inline marks', async () => {
    const text: string = [
      '= Title',
      ':toc: left',
      '// a comment',
      'Prose with *strong* and `mono` and https://example.org[a link].',
      '* an item',
      '----',
      '*not strong* in a listing',
      '----',
    ].join('\n');
    const result = await colour(text, '.adoc');
    expect(result).not.toBeNull();
    const { host, coloured } = result as { host: HTMLElement; coloured: string[] };
    expect(host.textContent).toBe(text);
    expect(coloured).toEqual(expect.arrayContaining([
      '= Title', ':toc:', '// a comment', '*strong*', '`mono`', 'https://example.org[a link]', '----', '*not strong* in a listing',
    ]));
    expect(coloured.some((span) => span.startsWith('* '))).toBe(true);
  });

  it('colours Markdown headings', async () => {
    const result = await colour('# Title\n\nplain', '.md');
    expect(result).not.toBeNull();
    expect(result?.host.textContent).toBe('# Title\n\nplain');
    expect(result?.coloured.join('')).toContain('Title');
  });

  it('leaves an unknown language, or a file too large, plain', async () => {
    expect(await sourceSpans_build('hello', '.txt')).toBeNull();
    expect(await sourceSpans_build('x'.repeat(512 * 1024 + 1), '.md')).toBeNull();
  });
});
