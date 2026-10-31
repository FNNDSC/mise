/**
 * @jest-environment jsdom
 */
/**
 * @file A Markdown or AsciiDoc document renders as its page, sanitized and
 * kept inside its pane: no script, no include, anchors renamed, links off
 * the page in a new tab, a neighbouring file's link going nowhere, images
 * named rather than fetched.
 */
import { describe, it, expect } from '@jest/globals';
import { document_is, document_render } from '../../src/features/view/document.js';

describe('document_is', () => {
  it('names Markdown and AsciiDoc, nothing else', () => {
    for (const path of ['/a/README.md', '/a/x.MARKDOWN', '/a/guide.adoc', '/a/b.asciidoc', '/a/c.asc']) {
      expect(document_is(path)).toBe(true);
    }
    for (const path of ['/a/x.txt', '/a/x.json', '/a/md', '/a/x.adoc.gz']) {
      expect(document_is(path)).toBe(false);
    }
  });
});

describe('document_render', () => {
  it('renders Markdown with no script, its anchors and links kept inside the pane', async () => {
    const article: HTMLElement | null = await document_render('/u/README.md', [
      '# Title',
      '',
      'Some **bold** text. <script>window.hit = 1</script>',
      '',
      '[out](https://example.org) [near](other.md) [here](#title) [there](#set-up)',
      '',
      '![a scan](scan.png)',
      '',
      '<h2 id="set-up">Set up</h2>',
    ].join('\n'));
    expect(article).not.toBeNull();
    const page: HTMLElement = article as HTMLElement;
    expect(page.classList.contains('doc-rendered')).toBe(true);
    expect(page.querySelector('h1')?.textContent).toBe('Title');
    expect(page.querySelector('strong')?.textContent).toBe('bold');
    expect(page.querySelector('script')).toBeNull();
    // marked gives a heading no id; it gets GitHub's slug, then the prefix.
    expect(page.querySelector('h1')?.id).toBe('doc-title');
    expect(page.querySelector('#set-up')).toBeNull();
    expect(page.querySelector('h2')?.id).toBe('doc-set-up');
    const links: HTMLAnchorElement[] = Array.from(page.querySelectorAll('a'));
    const out: HTMLAnchorElement | undefined = links.find((link) => link.textContent === 'out');
    expect(out?.target).toBe('_blank');
    expect(out?.rel).toBe('noopener noreferrer');
    const near: HTMLAnchorElement | undefined = links.find((link) => link.textContent === 'near');
    expect(near?.hasAttribute('href')).toBe(false);
    expect(near?.title).toBe('other.md');
    expect(links.find((link) => link.textContent === 'here')?.getAttribute('href')).toBe('#doc-title');
    expect(links.find((link) => link.textContent === 'there')?.getAttribute('href')).toBe('#doc-set-up');
    expect(page.querySelector('img')).toBeNull();
    expect(page.querySelector('.doc-image')?.textContent).toBe('[image: a scan]');
  });

  it('renders AsciiDoc in secure mode: sections, admonitions, listings, no include', async () => {
    const article: HTMLElement | null = await document_render('/u/guide.adoc', [
      '= Guide',
      '',
      '== Setup',
      '',
      'NOTE: careful',
      '',
      'include::/etc/passwd[]',
      '',
      '[source,sh]',
      '----',
      'make deploy',
      '----',
    ].join('\n'));
    expect(article).not.toBeNull();
    const page: HTMLElement = article as HTMLElement;
    expect(page.classList.contains('doc-asciidoc')).toBe(true);
    expect(page.querySelector('h1')?.textContent).toBe('Guide');
    expect(page.querySelector('h2')?.id).toBe('doc-_setup');
    expect(page.querySelector('.admonitionblock.note .content')?.textContent?.trim()).toBe('careful');
    expect(page.querySelector('pre code')?.textContent).toBe('make deploy');
    expect(page.textContent).not.toContain('root:');
  });

  it('leaves a document too large to lay out to its source', async () => {
    expect(await document_render('/u/big.md', 'x'.repeat(2 * 1024 * 1024 + 1))).toBeNull();
  });
});
