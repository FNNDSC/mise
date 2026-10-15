/**
 * @file Links: a web address that opens ARGUS at a path.
 *
 * `url <path>` (chell) and LINK (here) put a path in the address's
 * fragment: `https://titan.tch.harvard.edu/#/proc/jobs/feed_4389/pl-x_7`.
 * The fragment survives the door's login redirects (a browser carries it
 * across a redirect that names none), so the page that finally opens still
 * holds it, and lands there once: a feed or a node in RUNS, through the
 * same jump RUNS's JUMP TO takes, anything else in FILES. Landing never
 * moves the session's working directory: the console is the operator's.
 *
 * @module
 */

/** Where a link lands. */
export type LinkLanding =
  | { kind: 'runs'; target: string }
  | { kind: 'folder'; path: string };

/**
 * Reads where a link's fragment points.
 *
 * A path that ends at a feed (`feed_4389`) or a node (`pl-dicom_repack_639204`)
 * lands in RUNS on it; a path inside a node's `data`, or anywhere else,
 * opens in FILES — a file opens its folder.
 *
 * @param hash - The address's fragment, `#` included.
 * @returns The landing, or null when the fragment names no path.
 */
export function linkLanding_parse(hash: string): LinkLanding | null {
  if (!hash.startsWith('#/')) return null;
  let path: string;
  try {
    path = decodeURI(hash.slice(1));
  } catch {
    return null;
  }
  path = path.replace(/\/+$/, '') || '/';
  const segments: string[] = path.split('/').filter((segment: string): boolean => segment !== '');
  const last: string = segments[segments.length - 1] ?? '';
  const inData: boolean = segments.includes('data');
  if (!inData && (/^feed_\d+$/.test(last) || (/^[\w.-]+_\d+$/.test(last) && segments.some((segment: string): boolean => /^feed_\d+$/.test(segment))))) {
    return { kind: 'runs', target: last };
  }
  const isFile: boolean = /\.[A-Za-z0-9]{1,8}$/.test(last) && !/_\d+$/.test(last);
  return { kind: 'folder', path: isFile ? `/${segments.slice(0, -1).join('/')}` : path };
}

/**
 * The address a link opens: the page's own origin, with the path as its
 * fragment. Through the door that origin is the door; the page's own path
 * (a session's `/s/<key>/`, its token) is never shared.
 *
 * @param origin - The page's origin (`location.origin`).
 * @param absolutePath - The path the link opens.
 * @returns The link.
 */
export function link_compose(origin: string, absolutePath: string): string {
  return `${origin.replace(/\/+$/, '')}/#${encodeURI(absolutePath)}`;
}

/** How long a link line says COPIED before it reads LINK again. */
export const LINK_ANNOUNCE_MS: number = 2500;

/**
 * A link line: the link itself, in full, behind a LINK pill. It stands
 * under a place's name (the FILES trail, the RUNS graph's corner), so the
 * address is always in sight; a press on the pill or the address copies it
 * and the pill says what happened — COPIED, or SELECT + COPY with the
 * address selected for the hand when the browser would not copy.
 *
 * @param path - The path the link opens.
 * @returns The line.
 */
export function linkLine_build(path: string): HTMLElement {
  const line: HTMLElement = document.createElement('div');
  line.className = 'link-line';
  const pill: HTMLButtonElement = document.createElement('button');
  pill.type = 'button';
  pill.className = 'link-pill';
  pill.textContent = 'LINK';
  const address: HTMLElement = document.createElement('span');
  address.className = 'link-address';
  line.append(pill, address);
  linkLine_set(line, path);
  const press = (event: Event): void => {
    // The line stands inside a field and a trail: a press is the line's.
    event.stopPropagation();
    void linkLine_copy(line);
  };
  pill.addEventListener('click', press);
  address.addEventListener('click', press);
  return line;
}

/**
 * Points a link line at a path.
 *
 * @param line - The line.
 * @param path - The path the link opens.
 */
export function linkLine_set(line: HTMLElement, path: string): void {
  const link: string = link_compose(window.location.origin, path);
  const address: HTMLElement | null = line.querySelector('.link-address');
  if (address !== null && address.textContent !== link) address.textContent = link;
  line.dataset['link'] = link;
  line.title = `a link that opens ARGUS at ${path} — press to copy`;
}

/**
 * Copies a link line's address and says so on its pill.
 *
 * @param line - The line.
 * @param clipboard - The clipboard; the browser's own by default.
 * @returns Whether the browser took it.
 */
export async function linkLine_copy(line: HTMLElement, clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard): Promise<boolean> {
  const link: string = line.dataset['link'] ?? '';
  const pill: HTMLElement | null = line.querySelector('.link-pill');
  let copied: boolean = false;
  try {
    if (clipboard === undefined) throw new Error('no clipboard');
    await clipboard.writeText(link);
    copied = true;
  } catch {
    // An insecure page has no clipboard: the address is selected instead,
    // so the operator's own copy takes it.
    const address: HTMLElement | null = line.querySelector('.link-address');
    const selection: Selection | null = window.getSelection();
    if (address !== null && selection !== null) {
      const range: Range = document.createRange();
      range.selectNodeContents(address);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  line.dataset['copied'] = copied ? 'yes' : 'no';
  if (pill !== null) pill.textContent = copied ? 'COPIED' : 'SELECT + COPY';
  const shown: number = Date.now();
  line.dataset['shown'] = String(shown);
  setTimeout((): void => {
    if (line.dataset['shown'] !== String(shown)) return;
    delete line.dataset['copied'];
    if (pill !== null) pill.textContent = 'LINK';
  }, LINK_ANNOUNCE_MS);
  return copied;
}
