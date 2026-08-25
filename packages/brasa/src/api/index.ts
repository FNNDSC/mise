/**
 * @file The typed chell API: the shell's vocabulary as function calls.
 *
 * `chellApi_create()` returns an object whose methods are the chell commands
 * themselves, entered one layer above the parser: typed options in, typed
 * envelopes out. Each method calls the same per-command core the parsed
 * builtin calls, so the two entry points cannot drift, and no command line
 * is ever assembled or re-parsed.
 *
 * v1 is in-process and wraps the process-global session: `cd` moves the
 * same working directory the engine and any in-process REPL share. The
 * remote form arrives with the calypso wire revision. Design record:
 * docs/typed-chell-api.adoc.
 *
 * Typical usage:
 * ```typescript
 * const sh: ChellApi = await chellApi_create();
 * await sh.cd(`/home/${user}`);
 * await sh.mkdir('scratch');
 * await sh.touch('scratch/hello.txt', { contents: 'hi' });
 * const where = await sh.pwd();
 * if (where.status === 'ok') console.log(where.model?.data.path);
 * await sh.rm('scratch', { recursive: true });
 * ```
 *
 * @module
 */
import { session } from '../session/index.js';
import { mkdir_run } from '../builtins/fs/mkdir.js';
import { touch_run } from '../builtins/fs/touch.js';
import { rm_run } from '../builtins/fs/rm.js';
import { pwd_run } from '../builtins/fs/pwd.js';
import { cd_run } from '../builtins/fs/cd.js';
import { envelope_typed, type TypedEnvelope } from './models.js';

export type { TypedEnvelope, ModelKind, FsModelMap, CwdModel } from './models.js';
export { envelope_typed } from './models.js';

/** Options for {@link ChellApi.touch}. */
export interface TouchApiOptions {
  /** Literal content to write into the file. */
  contents?: string;
  /** Local file whose content is uploaded into the target. */
  contentsFromFile?: string;
}

/** Options for {@link ChellApi.rm}. */
export interface RmApiOptions {
  /** Remove directories and their contents. */
  recursive?: boolean;
  /** POSIX -f: missing operands succeed; no confirmation prompts. */
  force?: boolean;
}

/**
 * The chell command vocabulary as typed calls.
 *
 * Method names keep the shell's own verbs verbatim (`ls`, `mkdir`, `rm`):
 * they are the projection's external schema, the same exemption the style
 * guide grants wire field names. Every method resolves to the command's
 * envelope; a failed command is an `error`-status envelope, never a throw.
 */
export interface ChellApi {
  /**
   * Reports the session's current working directory.
   *
   * @param options - `titles` substitutes feed/plugin titles into the path.
   * @returns Envelope carrying the `fs.cwd` model.
   */
  pwd(options?: { titles?: boolean }): Promise<TypedEnvelope<'fs.cwd'>>;

  /**
   * Changes the session's working directory.
   *
   * @param path - Target directory; omit for home, `'-'` for the previous cwd.
   * @returns Envelope carrying the `fs.cwd` model on success.
   */
  cd(path?: string): Promise<TypedEnvelope<'fs.cwd'>>;

  /**
   * Creates one or more directories.
   *
   * @param paths - Directory path or paths, absolute or cwd-relative.
   * @returns Envelope whose `fs.mkdir` model lists per-target outcomes.
   */
  mkdir(paths: string | string[]): Promise<TypedEnvelope<'fs.mkdir'>>;

  /**
   * Creates a file, optionally with content.
   *
   * @param path - Target file path, absolute or cwd-relative.
   * @param options - Content source, when the file should not be empty.
   * @returns Envelope whose `fs.touch` model lists per-target outcomes.
   */
  touch(path: string, options?: TouchApiOptions): Promise<TypedEnvelope<'fs.touch'>>;

  /**
   * Removes files or directories.
   *
   * @param paths - Target path or paths, absolute or cwd-relative.
   * @param options - Recursive and force flags.
   * @returns Envelope whose `fs.rm` model lists per-target outcomes.
   */
  rm(paths: string | string[], options?: RmApiOptions): Promise<TypedEnvelope<'fs.rm'>>;
}

/**
 * Creates the typed chell API over the process-global session.
 *
 * Initializes the session layer (idempotent) so the returned object works
 * in a bare program; in a process that already runs an engine, the API and
 * the engine share cwd and connection.
 *
 * @returns The typed API.
 */
export async function chellApi_create(): Promise<ChellApi> {
  await session.init();

  return {
    pwd: (options?: { titles?: boolean }): Promise<TypedEnvelope<'fs.cwd'>> =>
      pwd_run({ titles: options?.titles }).then(envelope_typed<'fs.cwd'>),

    cd: (path?: string): Promise<TypedEnvelope<'fs.cwd'>> =>
      cd_run({ path }).then(envelope_typed<'fs.cwd'>),

    mkdir: (paths: string | string[]): Promise<TypedEnvelope<'fs.mkdir'>> =>
      mkdir_run({ paths: Array.isArray(paths) ? paths : [paths] }).then(envelope_typed<'fs.mkdir'>),

    touch: (path: string, options?: TouchApiOptions): Promise<TypedEnvelope<'fs.touch'>> =>
      touch_run({
        paths: [path],
        contents: options?.contents,
        contentsFromFile: options?.contentsFromFile,
      }).then(envelope_typed<'fs.touch'>),

    rm: (paths: string | string[], options?: RmApiOptions): Promise<TypedEnvelope<'fs.rm'>> =>
      rm_run({
        paths: Array.isArray(paths) ? paths : [paths],
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
        interactive: false,
      }).then(envelope_typed<'fs.rm'>),
  };
}
