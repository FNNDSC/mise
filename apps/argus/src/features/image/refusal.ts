/**
 * @file Why a read was refused, asked of the route that refused it.
 *
 * An image loader reports that a slice failed and little else; the daemon's
 * `/vfs` route answers a refused read with a status and one line saying
 * why (not yours to read, no such file, CUBE could not serve it). Asked
 * again after the failure, that line is the readout.
 */

/**
 * Asks the byte route why it refused a URL.
 *
 * @param url - The bytes' URL, as the loader used it (a `wadouri:` prefix
 *   and a `&frame=` suffix are stripped).
 * @returns The route's reason in capitals with its status, or a plain
 *   `COULD NOT BE READ` when the route itself does not answer.
 */
export async function refusal_explain(url: string): Promise<string> {
  const plain: string = url.replace(/^wadouri:/, '').replace(/&frame=\d+$/, '');
  try {
    const response: Response = await fetch(plain, { cache: 'no-store' });
    if (response.ok) return 'COULD NOT BE DECODED';
    const line: string = (await response.text()).split('\n')[0]?.trim() ?? '';
    // The route's line carries CUBE's status when it has one; the route's
    // own is added only when the line does not already say it.
    const said: string = (line === '' ? 'REFUSED' : line).toUpperCase();
    return said.includes(`(${response.status})`) ? said : `${said} (${response.status})`;
  } catch {
    return 'COULD NOT BE READ';
  }
}
