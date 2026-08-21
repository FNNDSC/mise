/**
 * @file Version reporting for the mise stack.
 *
 * Reads brasa's own package.json (this module lives in brasa) and those of the
 * surface (chell), session host (calypso), and engine layers (chili, salsa,
 * cumin), so the boot panel, the `version` command, and `--version` all report
 * a consistent set of versions. In the standalone bundled binary — where no
 * package.json exists on disk — the versions esbuild injected at build time
 * are used instead.
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
 * Build-time-injected map of stack versions, the bundled-binary counterpart to
 * reading each package's package.json. esbuild replaces it with a literal when
 * bundling the standalone binary (no package.json on disk). Undefined under tsc.
 */
declare const __STACK_VERSIONS__: Record<string, string>;

/**
 * The bundled-binary fallback version for a package, from the map esbuild
 * inlined at build time.
 *
 * @param name - The package name (e.g. `@fnndsc/cumin`).
 * @returns The injected version, or `'unknown'` if none was inlined.
 */
function injectedVersion_get(name: string): string {
  return typeof __STACK_VERSIONS__ !== 'undefined' ? (__STACK_VERSIONS__[name] ?? 'unknown') : 'unknown';
}

/**
 * Reads brasa's own version. This module lives in brasa, so its package.json is
 * two levels up from the compiled module; in the bundled binary that file is
 * absent and the build-time-injected version is used instead.
 *
 * @returns The brasa version string.
 */
function brasaVersion_load(): string {
  try {
    return (JSON.parse(readFileSync(path.resolve(moduleDir, '../../package.json'), 'utf-8')) as PackageJson).version;
  } catch {
    return injectedVersion_get('@fnndsc/brasa');
  }
}

/**
 * Loads a package's version via node module resolution, so it works whether the
 * package is nested or hoisted to a workspace-root node_modules. ChELL and
 * CALYPSO sit above brasa in the dependency tree but resolve as hoisted siblings;
 * in the bundled binary this falls back to the inlined versions.
 *
 * @param name - The package name (e.g. `@fnndsc/cumin`).
 * @returns The resolved version string, or the injected/`'unknown'` fallback.
 */
function packageVersion_load(name: string): string {
  try {
    const req = createRequire(import.meta.url);
    return (req(`${name}/package.json`) as PackageJson).version;
  } catch {
    return injectedVersion_get(name);
  }
}

/**
 * Build-time-injected git hash, the bundled-binary counterpart to reading
 * `dist/buildinfo.json`. esbuild replaces it with a literal when bundling the
 * standalone binary. Undefined under tsc.
 */
declare const __BUILD_HASH__: string;

/**
 * The short git hash this build of the stack was produced from.
 *
 * Reads `buildinfo.json`, written next to the compiled output by
 * `scripts/buildinfo.mjs` as the final build step. In the bundled binary the
 * esbuild-injected hash is used instead; when neither exists (running straight
 * from source under ts-jest, for instance) the marker `dev` is returned.
 *
 * @returns The six-character build hash, or `'dev'` when no build metadata exists.
 */
export function buildHash_get(): string {
  try {
    const info: { hash?: string } = JSON.parse(
      readFileSync(path.resolve(moduleDir, '../buildinfo.json'), 'utf-8'),
    ) as { hash?: string };
    if (typeof info.hash === 'string' && info.hash.length > 0) return info.hash;
  } catch {
    // No buildinfo.json beside the compiled output: fall through.
  }
  return typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
}

/** The architectural role a package plays in the stack. */
export type PackageRole = 'surface' | 'sessionHost' | 'engine' | 'layer';

/** A package's short name, full (backronym) name, and role — its version-less identity. */
interface PackageDescriptor {
  pkg: string;
  name: string;
  role: PackageRole;
}

/** That identity with a resolved version attached. */
export interface PackageInfo extends PackageDescriptor {
  version: string;
}

/**
 * The canonical description of every package in the stack, in the order the
 * flat `--version` report lists them: the chell surface, the brasa engine, its
 * chili/salsa/cumin layers, and the calypso assisted session host. This is the
 * single source of truth the version report, the `--info` table, and the boot
 * panel all draw from.
 */
const STACK: readonly PackageDescriptor[] = [
  { pkg: 'chell',   name: 'ChELL Executes Layered Logic',                                  role: 'surface' },
  { pkg: 'brasa',   name: 'BRASA Runs Abstracted Shell Actions',                           role: 'engine'  },
  { pkg: 'chili',   name: 'ChILI handles Intelligent Line Interactions',                   role: 'layer'   },
  { pkg: 'salsa',   name: 'Salsa Abstracts Logic Service Assets',                          role: 'layer'   },
  { pkg: 'cumin',   name: 'Cumin Underpins Management Infrastructure Needs',               role: 'layer'   },
  { pkg: 'calypso', name: 'CALYPSO Accepts Language, Yielding Permitted Shell Operations', role: 'sessionHost' },
];

/**
 * Resolves the running version of a descriptor's package. brasa reads its own
 * package.json directly (this module lives in it); every other package resolves
 * by name.
 *
 * @param descriptor - The package to resolve.
 * @returns The descriptor with its version attached.
 */
function packageInfo_resolve(descriptor: PackageDescriptor): PackageInfo {
  const version: string =
    descriptor.pkg === 'brasa' ? brasaVersion_load() : packageVersion_load(`@fnndsc/${descriptor.pkg}`);
  return { ...descriptor, version };
}

/**
 * The resolved identity and version of every package in the stack, in canonical
 * order.
 *
 * @returns One {@link PackageInfo} per package.
 */
export function stackInfo_get(): PackageInfo[] {
  return STACK.map(packageInfo_resolve);
}

/** The resolved version of every package in the stack, keyed by short name. */
export interface StackVersions {
  chell: string;
  brasa: string;
  chili: string;
  salsa: string;
  cumin: string;
  calypso: string;
}

/**
 * The resolved version of every package in the stack, keyed by short name.
 *
 * @returns The version strings, keyed by package.
 */
export function versions_get(): StackVersions {
  const byPkg: Record<string, string> = Object.fromEntries(stackInfo_get().map((i: PackageInfo) => [i.pkg, i.version]));
  return {
    chell: byPkg.chell,
    brasa: byPkg.brasa,
    chili: byPkg.chili,
    salsa: byPkg.salsa,
    cumin: byPkg.cumin,
    calypso: byPkg.calypso,
  };
}

/**
 * Builds the terse `--version` report: one aligned `name  version` line per
 * package, versions in a single column.
 *
 * @returns The version report string.
 */
export function versionReport_build(): string {
  const info: PackageInfo[] = stackInfo_get();
  const pkgWidth: number = Math.max(...info.map((i: PackageInfo) => i.pkg.length));
  return info.map((i: PackageInfo) => `${i.pkg.padEnd(pkgWidth)}  ${i.version}`).join('\n');
}

/**
 * Composes the startup welcome line from explicit version and build values.
 *
 * Separated from {@link welcomeLine_build} so a remote surface can render the
 * line from the versions the daemon reported in its attach handshake, rather
 * than from whatever happens to be installed client-side.
 *
 * @param pkg - The short package name whose backronym heads the line
 *   (e.g. `'chell'`, `'calypso'`). Unknown names fall back to the surface.
 * @param version - The package version to display.
 * @param build - The short build hash to display.
 * @returns A line of the form `ChELL Executes Layered Logic, v 5.3.0 (886f09). Welcome.`
 */
export function welcomeLine_compose(pkg: string, version: string, build: string): string {
  const descriptor: PackageDescriptor = STACK.find((d: PackageDescriptor) => d.pkg === pkg) ?? STACK[0];
  return `${descriptor.name}, v ${version} (${build}). Welcome.`;
}

/**
 * Builds the startup welcome line for a locally resolved package: its backronym
 * name, installed version, and the build hash of this checkout.
 *
 * @param pkg - The short package name (e.g. `'chell'`, `'calypso'`). Defaults
 *   to the chell surface.
 * @returns The composed welcome line.
 */
export function welcomeLine_build(pkg: string = 'chell'): string {
  const descriptor: PackageDescriptor = STACK.find((d: PackageDescriptor) => d.pkg === pkg) ?? STACK[0];
  const info: PackageInfo = packageInfo_resolve(descriptor);
  return welcomeLine_compose(descriptor.pkg, info.version, buildHash_get());
}

/** Human-readable heading for each role, in the order `--info` groups them. */
const ROLE_HEADINGS: readonly { role: PackageRole; heading: string }[] = [
  { role: 'surface',     heading: 'SURFACES'     },
  { role: 'sessionHost', heading: 'SESSION HOST' },
  { role: 'engine',      heading: 'ENGINE'       },
  { role: 'layer',       heading: 'LAYERS'       },
];

/**
 * Builds the detailed `--info` report: packages grouped by role (surfaces,
 * session host, engine, layers) under a heading, each row an aligned
 * `pkg  name  version`.
 *
 * @returns The info table string.
 */
export function infoReport_build(): string {
  const info: PackageInfo[] = stackInfo_get();
  const pkgWidth: number = Math.max(...info.map((i: PackageInfo) => i.pkg.length));
  const nameWidth: number = Math.max(...info.map((i: PackageInfo) => i.name.length));
  const lines: string[] = [];
  for (const { role, heading } of ROLE_HEADINGS) {
    const rows: PackageInfo[] = info.filter((i: PackageInfo) => i.role === role);
    if (rows.length === 0) continue;
    lines.push(heading);
    for (const row of rows) {
      lines.push(`  ${row.pkg.padEnd(pkgWidth)}  ${row.name.padEnd(nameWidth)}  ${row.version}`);
    }
  }
  return lines.join('\n');
}
