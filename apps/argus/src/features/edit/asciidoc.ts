/**
 * @file AsciiDoc's syntax colours: a line-oriented stream mode.
 *
 * CodeMirror has no AsciiDoc grammar of its own. The language is read a
 * line at a time — a heading, an attribute entry, a block delimiter, a
 * list marker, a comment — with inline marks inside prose, so a stream
 * mode colours it faithfully without a parser. A delimited listing or
 * literal block is held as one span of code until its closing line, and a
 * comment block as one comment, since nothing inside either is markup.
 *
 * @module
 */
import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** The open delimited block a line is inside, if its content is not markup. */
interface AsciidocState {
  /** The delimiter that closes the block (`----`, `....`, `////`, `++++`), or null in prose. */
  verbatim: string | null;
}

/** A block delimiter line: four or more of one character, or a table fence. */
const DELIMITER: RegExp = /^(?:-{4,}|\.{4,}|\/{4,}|\+{4,}|={4,}|\*{4,}|_{4,}|\|===|!===|```.*)\s*$/;

/** The delimiters whose content is shown as it is, never read as markup. */
const VERBATIM_DELIMITER: RegExp = /^(?:-{4,}|\.{4,}|\/{4,}|\+{4,}|```.*)\s*$/;

/** One inline mark: a link, a cross-reference, monospace, strong, or emphasis. */
const INLINE: ReadonlyArray<[RegExp, string]> = [
  [/^(?:https?|ftp|mailto):[^\s[\]]+(?:\[[^\]]*\])?/, 'link'],
  [/^(?:link|xref|mailto|image|include|kbd|btn|menu|footnote|pass|stem|latexmath|asciimath)::?[^\s[]*\[[^\]]*\]/, 'link'],
  [/^<<[^>]+>>/, 'link'],
  [/^`[^`\n]+`/, 'monospace'],
  [/^\*[^*\s](?:[^*\n]*[^*\s])?\*/, 'strong'],
  [/^_[^_\s](?:[^_\n]*[^_\s])?_/, 'emphasis'],
  [/^\{[\w-]+\}/, 'attributeName'],
];

/**
 * Reads the start of a line: the line kinds AsciiDoc knows by their first
 * characters.
 *
 * @param stream - The line, at its first character.
 * @param state - The block the line is inside.
 * @returns The token name, or null when the line is prose.
 */
function lineStart_read(stream: StringStream, state: AsciidocState): string | null {
  const line: string = stream.string;
  if (DELIMITER.test(line)) {
    if (VERBATIM_DELIMITER.test(line)) state.verbatim = line.trim().startsWith('```') ? '```' : line.trim();
    stream.skipToEnd();
    return 'meta';
  }
  if (/^\/\/(?!\/)/.test(line)) { stream.skipToEnd(); return 'comment'; }
  if (stream.match(/^={1,6}\s+\S.*$/) || stream.match(/^#{1,6}\s+\S.*$/)) return 'heading';
  if (stream.match(/^:!?[\w-]+!?:/)) return 'attributeName';
  if (stream.match(/^\[[^\]\n]*\]\s*$/)) return 'meta';
  if (stream.match(/^\.(?=[^\s.])/)) { stream.skipToEnd(); return 'heading'; }
  if (stream.match(/^(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):(?=\s)/)) return 'keyword';
  if (stream.match(/^\s*(?:\*{1,5}|\.{1,5}|-|\d+\.)\s+/)) return 'list';
  if (stream.match(/^\s*[^\s:][^:\n]*::(?:\s|$)/)) return 'attributeName';
  return null;
}

/** The stream parser behind the AsciiDoc language. */
const ASCIIDOC_PARSER: StreamParser<AsciidocState> = {
  name: 'asciidoc',
  startState: (): AsciidocState => ({ verbatim: null }),
  copyState: (state: AsciidocState): AsciidocState => ({ verbatim: state.verbatim }),
  token: (stream: StringStream, state: AsciidocState): string | null => {
    if (state.verbatim !== null) {
      const closing: boolean = stream.sol() && (state.verbatim === '```' ? stream.string.trim() === '```' : stream.string.trim() === state.verbatim);
      const comment: boolean = state.verbatim.startsWith('/');
      stream.skipToEnd();
      if (closing) {
        state.verbatim = null;
        return 'meta';
      }
      return comment ? 'comment' : 'monospace';
    }
    if (stream.sol()) {
      const kind: string | null = lineStart_read(stream, state);
      if (kind !== null) return kind;
    }
    for (const [pattern, kind] of INLINE) {
      if (stream.match(pattern)) return kind;
    }
    // A word is prose to its end; an inline mark starts only where one does.
    if (!stream.eatWhile(/\w/)) stream.next();
    return null;
  },
  blankLine: (): void => undefined,
  tokenTable: {
    heading: tags.heading,
    comment: tags.comment,
    meta: tags.meta,
    attributeName: tags.attributeName,
    keyword: tags.keyword,
    list: tags.list,
    link: tags.link,
    monospace: tags.monospace,
    strong: tags.strong,
    emphasis: tags.emphasis,
  },
};

/** AsciiDoc, as a CodeMirror language. */
export const asciidoc: StreamLanguage<AsciidocState> = StreamLanguage.define(ASCIIDOC_PARSER);
