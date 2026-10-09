/**
 * @file What a filesystem operation answers: done, or why not.
 *
 * A mount says why an operation failed the way a kernel does, with an
 * `errno`; the words an operator reads are written here, once, for every
 * mount and every backend. A mount that knows something no `errno` says
 * (CUBE cannot overwrite a file; a tag still worn by a feed) gives its own
 * reason, and that is what is read instead.
 *
 * @module
 */
import { Result, Ok, Err } from '../result.js';
import { errorStack, type StackMessage } from '../errorStack.js';

/** Why a filesystem operation failed. */
export type VfsErrno =
  | 'ENOENT'      // no such file or directory
  | 'EEXIST'      // already there
  | 'EISDIR'      // a folder, where a file was wanted
  | 'ENOTDIR'     // a file, where a folder was wanted
  | 'ENOTEMPTY'   // a folder that still holds something
  | 'EROFS'       // the mount does not offer the operation
  | 'EXDEV'       // a move from one mount to another
  | 'EACCES'      // not allowed to this user
  | 'EPERM'       // not allowed to anyone, by what the item is
  | 'EIO';        // the store failed

/** An operation's answer: its value, or why it failed and, perhaps, the mount's own reason. */
export type VfsOutcome<T = true> =
  | { ok: true; value: T }
  | { ok: false; errno: VfsErrno; reason?: string };

/**
 * A success.
 *
 * @param value - What the operation gives back.
 * @returns The outcome.
 */
export function vfs_ok<T>(value: T): VfsOutcome<T> {
  return { ok: true, value };
}

/**
 * A failure.
 *
 * @param errno - Why.
 * @param reason - The mount's own words, when it knows more than the errno says.
 * @returns The outcome.
 */
export function vfs_fail<T = never>(errno: VfsErrno, reason?: string): VfsOutcome<T> {
  return reason === undefined ? { ok: false, errno } : { ok: false, errno, reason };
}

/** The operations whose refusals are worded here. */
export type VfsOperation = 'read' | 'readBinary' | 'write' | 'mkdir' | 'rmdir' | 'rename' | 'rm' | 'cp';

/** The errno's own words, as `strerror` gives them. */
const ERRNO_WORDS: Readonly<Record<VfsErrno, string>> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  ENOTEMPTY: 'Directory not empty',
  EROFS: 'Read-only file system',
  EXDEV: 'Invalid cross-device link',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  EIO: 'Input/output error',
};

/**
 * The errno in words.
 *
 * @param errno - The errno.
 * @returns Its words.
 */
export function errno_words(errno: VfsErrno): string {
  return ERRNO_WORDS[errno];
}

/**
 * What an operator reads when an operation failed: the mount's own reason
 * when it gave one, else the operation's sentence for the errno.
 *
 * @param operation - The operation.
 * @param outcome - Its failure.
 * @param path - The path it was asked of.
 * @param dest - The destination, for a rename or a copy.
 * @returns The sentence.
 */
export function vfsRefusal_text(
  operation: VfsOperation,
  outcome: { errno: VfsErrno; reason?: string },
  path: string,
  dest?: string,
): string {
  if (outcome.reason !== undefined) return outcome.reason;
  const words: string = errno_words(outcome.errno);
  switch (operation) {
    case 'read':
      return outcome.errno === 'EROFS' ? `File read not supported for path: ${path}` : `${path}: ${words}`;
    case 'readBinary':
      return outcome.errno === 'EROFS' ? `Binary file read not supported for path: ${path}` : `${path}: ${words}`;
    case 'write':
      return outcome.errno === 'EROFS' ? `File write not supported for path: ${path}` : `${path}: ${words}`;
    case 'mkdir':
      return `mkdir: cannot create directory '${path}': ${words}`;
    case 'rmdir':
      return `rmdir: failed to remove '${path}': ${words}`;
    case 'rename':
      return outcome.errno === 'EXDEV'
        ? `mv: cannot move '${path}' to '${dest ?? ''}': ${words}`
        : `mv: cannot move '${path}': ${words}`;
    case 'rm':
      return `rm: cannot remove '${path}': ${words}`;
    case 'cp':
      return `cp: cannot copy '${path}' to '${dest ?? ''}': ${words}`;
  }
}

/**
 * A failure carrying the newest message on the error stack as its reason,
 * that message taken off the stack (its function stamp removed). For a
 * mount whose failures are pushed deeper down: the words reach the caller
 * as the reason, and the caller says them.
 *
 * @param errno - Why, as an errno.
 * @returns The failure.
 */
export function vfs_failFromStack<T = never>(errno: VfsErrno): VfsOutcome<T> {
  const top: StackMessage | undefined = errorStack.stack_pop();
  if (top === undefined) return vfs_fail(errno);
  return vfs_fail(errno, top.message.replace(/^\[[^\]]*\]\s*\|\s*/, ''));
}

/**
 * An outcome from a Result whose failure left its reason on the error stack.
 *
 * @param result - The Result.
 * @param errno - The errno a failure carries.
 * @returns The outcome.
 */
export function vfsOutcome_ofResult<T>(result: Result<T>, errno: VfsErrno): VfsOutcome<T> {
  return result.ok ? vfs_ok(result.value) : vfs_failFromStack(errno);
}

/**
 * An outcome from a boolean whose false left its reason on the error stack.
 *
 * @param done - Whether the operation was done.
 * @param errno - The errno a failure carries.
 * @returns The outcome.
 */
export function vfsOutcome_ofBoolean(done: boolean, errno: VfsErrno): VfsOutcome {
  return done ? vfs_ok(true) : vfs_failFromStack(errno);
}

/**
 * Says a failure on the error stack, in the words the operator reads, and
 * gives back a Result: for a caller whose own callers read the stack.
 *
 * @param outcome - The outcome.
 * @param operation - The operation, for the words.
 * @param path - The path it was asked of.
 * @param dest - The destination, for a rename or a copy.
 * @returns The value as a Result, or Err with the words on the stack.
 */
export function vfsOutcome_toResult<T>(outcome: VfsOutcome<T>, operation: VfsOperation, path: string, dest?: string): Result<T> {
  if (outcome.ok) return Ok(outcome.value);
  errorStack.stack_push('error', vfsRefusal_text(operation, outcome, path, dest));
  return Err();
}
