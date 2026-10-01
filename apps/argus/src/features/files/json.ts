/**
 * @file JSON laid out as the structure it is. Dependency-free, like csv.ts:
 * the browser's content view shows it, and a unit test can read it.
 */

/** A file read as JSON when it is named as one. */
export const JSON_FILE_PATTERN: RegExp = /\.json$/i;

/** Past this a pretty print is work the page would stall on; the bytes are shown instead. */
const JSON_PRETTY_MAX_BYTES: number = 4 * 1024 * 1024;

/** One JSON token: a string (a key when a colon follows), a number, or a literal. */
const JSON_TOKEN: RegExp = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/**
 * Lays JSON out as structure: two-space indentation, each token in a span
 * naming its kind, so the stylesheet can colour keys apart from values.
 *
 * @param content - The file's text.
 * @returns The fragment, or null when the text is not JSON or too large.
 */
export function jsonPretty_build(content: string): DocumentFragment | null {
  if (content.length > JSON_PRETTY_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const pretty: string = JSON.stringify(parsed, null, 2);
  const fragment: DocumentFragment = document.createDocumentFragment();
  let last: number = 0;
  JSON_TOKEN.lastIndex = 0;
  for (let match: RegExpExecArray | null = JSON_TOKEN.exec(pretty); match !== null; match = JSON_TOKEN.exec(pretty)) {
    if (match.index > last) fragment.append(pretty.slice(last, match.index));
    const span: HTMLSpanElement = document.createElement('span');
    const [whole, string, colon, number, literal] = match;
    if (string !== undefined) {
      span.className = colon !== undefined ? 'json-key' : 'json-string';
      span.textContent = string;
      fragment.append(span);
      if (colon !== undefined) fragment.append(colon);
    } else if (number !== undefined) {
      span.className = 'json-number';
      span.textContent = number;
      fragment.append(span);
    } else {
      span.className = 'json-literal';
      span.textContent = literal ?? whole;
      fragment.append(span);
    }
    last = match.index + whole.length;
  }
  if (last < pretty.length) fragment.append(pretty.slice(last));
  return fragment;
}

