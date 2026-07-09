/**
 * @file Version reporting for chell and its sandwich layers.
 *
 * Reads chell's own package.json and those of the cumin/salsa/chili layers, so
 * the boot panel, the `version` command, and `--version` all report a
 * consistent set of versions. In the standalone bundled binary — where no
 * package.json exists on disk — the versions esbuild injected at build time are
 * used instead.
 *
 * @module
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

/** The subset of package.json fields this module reads. */
interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

const moduleDir: string = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build-time-injected version string. esbuild replaces `__CHELL_VERSION__` with
 * a literal when bundling the standalone binary (no package.json on disk).
 * Undefined in a normal tsc build.
 */
declare const __CHELL_VERSION__: string;

/**
 * Build-time-injected map of dependency versions, the bundled-binary
 * counterpart to reading each dependency's package.json. Undefined under tsc.
 */
declare const __CHELL_DEP_VERSIONS__: Record<string, string>;

/**
 * Reads chell's own package.json, falling back to the build-time version in the
 * bundled binary where that file is not present on disk.
 *
 * @returns The parsed package.json (or a `{ name, version }` fallback).
 */
function selfPackageJson_load(): PackageJson {
  try {
    return JSON.parse(readFileSync(path.resolve(moduleDir, '../../package.json'), 'utf-8')) as PackageJson;
  } catch {
    const version: string = typeof __CHELL_VERSION__ !== 'undefined' ? __CHELL_VERSION__ : 'unknown';
    return { name: '@fnndsc/chell', version };
  }
}

/**
 * Loads a dependency's package.json via node module resolution, so it works
 * whether the dep is nested or hoisted to a workspace-root node_modules. In the
 * bundled binary it falls back to the versions inlined at build time.
 *
 * @param name - The package name (e.g. `@fnndsc/cumin`).
 * @returns The parsed package.json, or a fallback `{ name, version }`.
 */
function depPackageJson_load(name: string): PackageJson {
  try {
    const req = createRequire(import.meta.url);
    return req(`${name}/package.json`) as PackageJson;
  } catch {
    const version: string =
      typeof __CHELL_DEP_VERSIONS__ !== 'undefined' ? (__CHELL_DEP_VERSIONS__[name] ?? 'unknown') : 'unknown';
    return { name, version };
  }
}

const chellJson: PackageJson = selfPackageJson_load();
const cuminJson: PackageJson = depPackageJson_load('@fnndsc/cumin');
const salsaJson: PackageJson = depPackageJson_load('@fnndsc/salsa');
const chiliJson: PackageJson = depPackageJson_load('@fnndsc/chili');

/** The resolved version of every layer of the stack, in sandwich order. */
export interface StackVersions {
  chell: string;
  chili: string;
  salsa: string;
  cumin: string;
}

/**
 * The resolved version of every layer of the stack.
 *
 * @returns The chell/chili/salsa/cumin version strings.
 */
export function versions_get(): StackVersions {
  return {
    chell: chellJson.version,
    chili: chiliJson.version,
    salsa: salsaJson.version,
    cumin: cuminJson.version,
  };
}

/**
 * Builds the multi-line version report shown by the `version` command and
 * `--version`: chell itself plus the sandwich layers it runs with.
 *
 * @returns The version report string.
 */
export function versionReport_build(): string {
  const versions: StackVersions = versions_get();
  return [
    `chell ${versions.chell}`,
    `  chili ${versions.chili}`,
    `  salsa ${versions.salsa}`,
    `  cumin ${versions.cumin}`,
  ].join('\n');
}
