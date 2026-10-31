/**
 * @file A document rendered as the page it describes: Markdown and
 * AsciiDoc, read in the Viewer pane or behind a RENDERED pill.
 *
 * A file opened to read shows its source in colour; a document is also
 * worth reading as its author meant it. The engines load on demand
 * (documentEngines.ts). What they produce is sanitized and then kept
 * inside its pane: its anchors are renamed so they cannot meet the page's
 * own ids, an in-document link scrolls the pane, a link off the page opens
 * a new tab, and a link to a neighbouring file is shown but goes nowhere.
 * Images are named, not fetched: a document's picture lives beside it,
 * which the page cannot reach without the session, and a remote one
 * would tell its host who is reading.
 *
 * @module
 */

/** A file rendered as a document when it is named as one. */
export const DOCUMENT_FILE_PATTERN: RegExp = /\.(?:md|markdown|adoc|asciidoc|asc)$/i;

/** Past this, a render is work the page would stall on; the source is shown instead. */
const DOCUMENT_RENDER_MAX_BYTES: number = 2 * 1024 * 1024;

/** The prefix a rendered document's anchors wear, so none can be one of the page's. */
const ANCHOR_PREFIX: string = 'doc-';

/**
 * Whether a path names a document this surface renders.
 *
 * @param path - The file's path.
 * @returns True for Markdown and AsciiDoc.
 */
export function document_is(path: string): boolean {
  return DOCUMENT_FILE_PATTERN.test(path);
}

/**
 * Gives a Markdown document's headings the anchors its links are written
 * against: GitHub's slugs, lowercased, punctuation dropped, spaces as
 * hyphens, a repeat numbered. marked writes headings with no id, so a
 * README's table of contents pointed nowhere.
 *
 * @param article - The rendered document.
 */
function headingSlugs_set(article: HTMLElement): void {
  const seen: Map<string, number> = new Map();
  for (const heading of Array.from(article.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))) {
    if (heading.id !== '') continue;
    const base: string = (heading.textContent ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const count: number = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    heading.id = count === 0 ? base : `${base}-${count}`;
  }
}

/**
 * Keeps a rendered document inside its pane: anchors renamed, links
 * answered in place, images named by their alt text.
 *
 * @param article - The rendered document.
 */
function document_contain(article: HTMLElement): void {
  for (const node of Array.from(article.querySelectorAll<HTMLElement>('[id]'))) {
    node.id = `${ANCHOR_PREFIX}${node.id}`;
  }
  for (const link of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href: string = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      link.setAttribute('href', `#${ANCHOR_PREFIX}${href.slice(1)}`);
    } else if (/^(?:https?:|mailto:)/i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.removeAttribute('href');
      link.classList.add('doc-link-local');
      link.title = href;
    }
  }
  for (const image of Array.from(article.querySelectorAll<HTMLImageElement>('img'))) {
    const named: HTMLSpanElement = document.createElement('span');
    named.className = 'doc-image';
    named.textContent = `[image: ${image.alt !== '' ? image.alt : (image.getAttribute('src') ?? '')}]`;
    image.replaceWith(named);
  }
  // An in-document link moves the pane, never the page's address.
  article.addEventListener('click', (event: MouseEvent): void => {
    const link: HTMLAnchorElement | null = (event.target as Element | null)?.closest('a[href^="#"]') ?? null;
    if (link === null) return;
    event.preventDefault();
    const target: Element | null = article.querySelector(`[id="${CSS.escape((link.getAttribute('href') ?? '').slice(1))}"]`);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

/**
 * Renders a document's text as its page.
 *
 * @param path - The file's path; its extension names the language.
 * @param text - The document's source.
 * @returns The rendered document, or null when it is too large to lay out.
 */
export async function document_render(path: string, text: string): Promise<HTMLElement | null> {
  if (text.length > DOCUMENT_RENDER_MAX_BYTES) return null;
  const { documentHtml_build } = await import('./documentEngines.js');
  const kind: 'markdown' | 'asciidoc' = /\.(?:md|markdown)$/i.test(path) ? 'markdown' : 'asciidoc';
  const article: HTMLElement = document.createElement('article');
  article.className = `doc-rendered doc-${kind}`;
  article.innerHTML = await documentHtml_build(text, kind);
  if (kind === 'markdown') headingSlugs_set(article);
  document_contain(article);
  return article;
}
