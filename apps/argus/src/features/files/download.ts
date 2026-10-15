/**
 * @file A file brought down to the operator's disk, or a reason it was not.
 *
 * DOWNLOAD used to be an anchor pressed at the byte route: the browser
 * fetched the URL on its own and saved whatever came back. When what came
 * back was not the file — the door's login page after a lapsed cookie, the
 * daemon's `not found` — the browser saved THAT, named after the URL's last
 * segment: a broken file called `vfs`, and nothing on the surface said so.
 *
 * Here the page asks first, with its own credentials, and saves only an
 * answer that is the file: a 2xx, not redirected anywhere, carrying the
 * attachment header the daemon puts on every download. Anything else is
 * a refusal the caller says out loud. The saved name is the one the header
 * gives, else the path's own basename — never the route's.
 */

/** Bytes above which the page hands the save back to the browser. */
export const DOWNLOAD_BLOB_MAX_BYTES: number = 256 * 1024 * 1024;

/**
 * How a download ended.
 *
 * @property ok - Whether the file reached the browser's save.
 * @property name - The name it was saved under.
 * @property bytes - Its size, when known.
 * @property streamed - True when the browser fetched it itself (too large to
 *   hold in the page).
 * @property reason - Why it was refused.
 */
export type DownloadOutcome =
  | { ok: true; name: string; bytes: number | null; streamed: boolean }
  | { ok: false; reason: string };

/**
 * The name a download is saved under: the attachment header's UTF-8
 * `filename*`, else its quoted `filename`, else the path's basename.
 *
 * @param disposition - The `content-disposition` header, or null.
 * @param path - The ChRIS path that was asked for.
 * @returns A non-empty file name.
 */
export function attachmentName_read(disposition: string | null, path: string): string {
  const fallback: string = path.split('/').filter((part: string): boolean => part.length > 0).pop() ?? 'download';
  if (disposition === null) return fallback;
  const extended: RegExpExecArray | null = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (extended !== null) {
    try {
      const decoded: string = decodeURIComponent((extended[1] ?? '').trim());
      if (decoded.length > 0) return decoded;
    } catch {
      // A malformed escape falls through to the plain name.
    }
  }
  const plain: RegExpExecArray | null = /filename\s*=\s*"([^"]*)"/i.exec(disposition);
  const name: string = plain?.[1] ?? '';
  return name.length > 0 ? name : fallback;
}

/**
 * Whether an answer is the file asked for, and if not, why.
 *
 * @param response - What the byte route answered.
 * @returns Null when it is the file; otherwise the refusal.
 */
export function downloadAnswer_refusal(response: Pick<Response, 'ok' | 'status' | 'redirected' | 'headers'>): string | null {
  if (response.redirected) return 'the session asked to log in again — nothing was saved';
  if (!response.ok) return response.status === 404
    ? 'the session could not read that file — nothing was saved'
    : `the session refused the file (HTTP ${response.status}) — nothing was saved`;
  if (response.headers.get('content-disposition') === null) return 'the session answered with something other than the file — nothing was saved';
  return null;
}

/**
 * Presses the browser's save on a URL under a name.
 *
 * @param href - A same-origin or object URL.
 * @param name - The name to save under.
 */
function anchor_press(href: string, name: string): void {
  const anchor: HTMLAnchorElement = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** A download's id: what the daemon counts it by. */
export function downloadId_make(): string {
  return `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Brings one file down: asks the session to open it, and saves only the file.
 *
 * The ask is a probe (HEAD, `probe=1`) under the download's id: the daemon
 * waits on CUBE, answers the file's headers, and holds the stream for the
 * save that follows, so CUBE is asked once. A file small enough is held in
 * the page and saved from there; a larger one is handed to the browser to
 * fetch itself — the name still given, the bytes streamed to disk. Either
 * way the daemon counts the bytes under the id, for the progress a
 * transfer row reads (transfer.ts).
 *
 * @param url - The byte route's download URL for the path.
 * @param path - The ChRIS path, for the fallback name.
 * @param fetcher - The fetch to use; the page's own by default.
 * @param id - The download's id.
 * @returns How it ended.
 */
export async function browserDownload_save(url: string, path: string, fetcher: typeof fetch = fetch, id: string = downloadId_make()): Promise<DownloadOutcome> {
  const tagged: string = `${url}&dl=${encodeURIComponent(id)}`;
  let probe: Response;
  try {
    probe = await fetcher(`${tagged}&probe=1`, { method: 'HEAD', credentials: 'same-origin' });
  } catch (error: unknown) {
    return { ok: false, reason: `the session did not answer (${error instanceof Error ? error.message : String(error)}) — nothing was saved` };
  }
  const refusal: string | null = downloadAnswer_refusal(probe);
  if (refusal !== null) return { ok: false, reason: refusal };
  const name: string = attachmentName_read(probe.headers.get('content-disposition'), path);
  const length: number = Number(probe.headers.get('content-length') ?? NaN);
  if (!Number.isFinite(length) || length > DOWNLOAD_BLOB_MAX_BYTES) {
    anchor_press(tagged, name);
    return { ok: true, name, bytes: Number.isFinite(length) ? length : null, streamed: true };
  }
  let response: Response;
  try {
    response = await fetcher(tagged, { credentials: 'same-origin' });
  } catch (error: unknown) {
    return { ok: false, reason: `the session did not answer (${error instanceof Error ? error.message : String(error)}) — nothing was saved` };
  }
  const refused: string | null = downloadAnswer_refusal(response);
  if (refused !== null) return { ok: false, reason: refused };
  const blob: Blob = await response.blob();
  const objectUrl: string = URL.createObjectURL(blob);
  anchor_press(objectUrl, name);
  // Revoking at once can cancel a save the browser has not started reading.
  setTimeout((): void => URL.revokeObjectURL(objectUrl), 60_000);
  return { ok: true, name, bytes: blob.size, streamed: false };
}
