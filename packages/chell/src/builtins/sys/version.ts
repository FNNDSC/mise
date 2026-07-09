/**
 * @file Builtin version.
 * Reports the chell stack versions (chell plus the chili/salsa/cumin layers) as
 * a command envelope — the in-shell counterpart of `chell --version`.
 */
import { CommandEnvelope, envelope_ok } from '@fnndsc/cumin';
import { versionReport_build, versions_get, type StackVersions } from '../../core/version.js';

/**
 * Reports the version of chell and the sandwich layers it runs with — the same
 * report as `chell --version`, available from inside the shell.
 *
 * @param _args - Unused.
 * @returns An envelope carrying the multi-line version report and a typed model
 *   of each layer's version.
 */
export async function builtin_version(_args: string[]): Promise<CommandEnvelope> {
  const versions: StackVersions = versions_get();
  return envelope_ok(`${versionReport_build()}\n`, {
    kind: 'sys.version',
    data: versions,
  });
}
