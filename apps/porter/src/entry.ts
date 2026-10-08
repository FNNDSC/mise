/**
 * @file Whether this module is the program node was asked to run.
 *
 * npm installs a bin as a symlink named for the command (`<prefix>/bin/porter
 * -> …/dist/porter.js`), and node leaves `argv[1]` as the path it was invoked
 * by. A test of how `argv[1]` is spelled (it ends in `porter.js`) is false
 * through the link, and the module loads and exits without a word (#961).
 * Both sides are compared as real paths instead, as chell and calypso do.
 *
 * @module
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at `moduleUrl` is the entry point node was started on.
 *
 * @param argv1 - `process.argv[1]`: the path node was invoked with, a link or not.
 * @param moduleUrl - The module's own `import.meta.url`.
 * @returns True when both resolve to the same file; false when imported, or when either cannot be resolved.
 */
export function entry_isMain(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    // argv[1] missing or unresolvable: imported, not run.
    return false;
  }
}
