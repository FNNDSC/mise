/**
 * @file Syntax colours: which language an extension names, and the colours
 * its tokens wear.
 *
 * Two places colour source text: the editor's field, and the files pane's
 * view of a file opened to read. Both ask this module, so a file reads in
 * the same colours whether it is being read or changed. Like the field, it
 * is loaded on demand: a page that never shows source never fetches it.
 *
 * @module
 */
import type { Extension } from '@codemirror/state';
import { HighlightStyle, type Language, type LanguageSupport } from '@codemirror/language';
import { highlightCode, tags } from '@lezer/highlight';

/**
 * The syntax colours, from the theme's own tokens, so every scheme (and
 * PHAROS) paints code in its palette and never in the library's.
 */
export const HIGHLIGHT: HighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--harvestgold)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--honey)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--daybreak)' },
  { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.variableName)], color: 'var(--orange)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--pumpkin-pie)', fontStyle: 'italic' },
  { tag: [tags.heading, tags.strong], color: 'var(--butter)', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--harvestgold)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--honey)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--pumpkin-pie)' },
  { tag: tags.list, color: 'var(--orange)' },
  { tag: tags.invalid, color: 'var(--state-error)' },
]);

/** Past this, colouring a file opened to read is work the page would stall on; it is shown plain. */
const SOURCE_COLOUR_MAX_BYTES: number = 512 * 1024;

/**
 * The language a file's extension names, loaded only when one is asked for.
 *
 * @param extension - The file's extension, with its dot.
 * @returns The language, or null for plain text.
 */
async function language_load(extension: string): Promise<Language | LanguageSupport | null> {
  switch (extension.toLowerCase()) {
    case '.json': return (await import('@codemirror/lang-json')).json();
    case '.yaml': case '.yml': return (await import('@codemirror/lang-yaml')).yaml();
    case '.md': case '.markdown': return (await import('@codemirror/lang-markdown')).markdown();
    case '.adoc': case '.asciidoc': case '.asc': return (await import('./asciidoc.js')).asciidoc;
    case '.py': return (await import('@codemirror/lang-python')).python();
    case '.js': case '.mjs': case '.cjs': return (await import('@codemirror/lang-javascript')).javascript();
    case '.ts': case '.mts': return (await import('@codemirror/lang-javascript')).javascript({ typescript: true });
    default: return null;
  }
}

/**
 * The editor extension for a file's language.
 *
 * @param extension - The file's extension, with its dot.
 * @returns The language extension, or none for plain text.
 */
export async function language_resolve(extension: string): Promise<Extension> {
  return (await language_load(extension)) ?? [];
}

/** Whether the colours' stylesheet is on the page yet. */
let highlightMounted: boolean = false;

/**
 * Puts the colours' rules on the page once. The editor mounts them through
 * its view; text coloured outside one needs them mounted by hand.
 */
function highlight_mount(): void {
  if (highlightMounted || HIGHLIGHT.module === null) return;
  const style: HTMLStyleElement = document.createElement('style');
  style.dataset['syntax'] = 'colours';
  style.textContent = HIGHLIGHT.module.getRules();
  document.head.appendChild(style);
  highlightMounted = true;
}

/**
 * Lays a file's text out in its language's colours: each token a span
 * wearing its colour's class, line breaks as they are.
 *
 * @param text - The file's text.
 * @param extension - The file's extension, with its dot.
 * @returns The coloured text, or null when the language is unknown or the
 *   text too large to colour.
 */
export async function sourceSpans_build(text: string, extension: string): Promise<DocumentFragment | null> {
  if (text.length > SOURCE_COLOUR_MAX_BYTES) return null;
  const loaded: Language | LanguageSupport | null = await language_load(extension);
  if (loaded === null) return null;
  const language: Language = 'language' in loaded ? loaded.language : loaded;
  highlight_mount();
  const fragment: DocumentFragment = document.createDocumentFragment();
  highlightCode(
    text,
    language.parser.parse(text),
    HIGHLIGHT,
    (code: string, classes: string): void => {
      if (classes === '') {
        fragment.append(code);
        return;
      }
      const span: HTMLSpanElement = document.createElement('span');
      span.className = classes;
      span.textContent = code;
      fragment.append(span);
    },
    (): void => { fragment.append('\n'); },
  );
  return fragment;
}
