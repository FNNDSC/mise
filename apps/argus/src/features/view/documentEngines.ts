/**
 * @file The document engines: Markdown through marked, AsciiDoc through
 * Asciidoctor, and every result through DOMPurify.
 *
 * This module is the one place the three libraries are named, and it is
 * loaded on demand (document.ts imports it at the first render), so a page
 * that never renders a document never fetches them — Asciidoctor alone is
 * about a megabyte.
 *
 * @module
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { convert } from '@asciidoctor/core';

/** What a rendered document may not carry: anything that runs, submits, embeds or styles the page. */
const FORBID_TAGS: string[] = ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'link', 'meta', 'base'];

/**
 * A document's text as sanitized HTML.
 *
 * AsciiDoc converts in Asciidoctor's SECURE mode: no `include::`, nothing
 * read from a disk or a URL. Markdown's raw HTML passes through marked as
 * written, so the sanitizer, not the converter, is what keeps a script out.
 *
 * @param text - The document's source.
 * @param kind - Its language.
 * @returns The HTML, safe to set as markup.
 */
export async function documentHtml_build(text: string, kind: 'markdown' | 'asciidoc'): Promise<string> {
  const html: string = kind === 'asciidoc'
    ? String(await convert(text, { safe: 'secure', standalone: false, attributes: { showtitle: '', icons: null } }))
    : await marked.parse(text, { gfm: true });
  return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR: ['style'] });
}
