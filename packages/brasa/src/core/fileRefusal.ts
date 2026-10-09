/**
 * @file A refused file read: the status the byte route answers with and one
 * line for the operator. A backend names its own refusals (ChRIS:
 * `chris/files.ts`). Its own module so a test can read it without the engine
 * (which jest cannot load whole).
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
