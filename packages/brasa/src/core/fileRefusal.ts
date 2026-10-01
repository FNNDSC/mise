/**
 * @file A refused file read, named: the status the byte route answers with
 * and one line for the operator. Its own module so a test can read it
 * without the engine (which jest cannot load whole).
 */

/**
 * A read the kernel refused, carrying WHY: the HTTP status the byte route
 * should answer with and one line for the operator. `/vfs` used to say
 * `404 not found` for every failure — a 403 from CUBE on a shared feed's
 * file, a file CUBE never registered, a CUBE that fell over — and the
 * surface could only say REFUSED.
 */
export class FileReadRefusal extends Error {
  /** The status the byte route answers with. */
  public readonly status: number;
  /** One line saying why, in the operator's words. */
  public readonly reason: string;

  constructor(filePath: string, status: number, reason: string) {
    super(`cannot read ${filePath}: ${reason}`);
    this.name = 'FileReadRefusal';
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Reads the kernel's notes since a checkpoint and names the refusal: a
 * status for the route and a line for the operator. CUBE's own status is
 * taken from the note when it carries one; a file the lookup could not
 * find is 404; anything else is the kernel's own failure, 502, so a 404
 * never again stands for "something went wrong".
 *
 * @param filePath - The file asked for.
 * @param notes - The kernel's error notes since the read began, oldest first.
 * @returns The refusal to throw.
 */
export function fileRefusal_name(filePath: string, notes: ReadonlyArray<string>): FileReadRefusal {
  const last: string = notes[notes.length - 1] ?? '';
  const status: number | undefined = notes.map((note: string): number => Number(/\b(40[0-9]|41[0-9]|5[0-9][0-9])\b/.exec(note)?.[1] ?? NaN)).find((n: number): boolean => !Number.isNaN(n));
  if (status === 403 || status === 401) return new FileReadRefusal(filePath, 403, 'not yours to read: CUBE refused the bytes (403)');
  if (status === 404 || /not found|no files found/i.test(last)) return new FileReadRefusal(filePath, 404, 'no such file in CUBE (404)');
  if (status !== undefined && status >= 500) return new FileReadRefusal(filePath, 502, `CUBE could not serve it (${status})`);
  // A note reads `[function     ] | message`; the operator gets the message.
  return new FileReadRefusal(filePath, 502, last.replace(/^\[[^\]]*\]\s*\|\s*/, '').trim() || 'could not be read');
}

