/**
 * @file The daemon fingerprints its own code: content moves the
 * fingerprint, a file's time alone does not, and the watch tells each flip.
 */
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { codeFingerprint_read, codeWatch_start, daemonPackageRoots_find } from '../src/daemon/codeIdentity';

describe('codeFingerprint_read', () => {
  let root: string;
  let pkg: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'calypso-code-'));
    pkg = path.join(root, 'brasa');
    mkdirSync(path.join(pkg, 'dist', 'core'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@fnndsc/brasa', version: '0.31.1' }));
    writeFileSync(path.join(pkg, 'dist', 'index.js'), 'export * from "./core/a.js";\n');
    writeFileSync(path.join(pkg, 'dist', 'core', 'a.js'), 'export const a = 1;\n');
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('moves when a compiled script changes, even deep in dist and at the same version', async () => {
    const before: string = await codeFingerprint_read([pkg]);
    writeFileSync(path.join(pkg, 'dist', 'core', 'a.js'), 'export const a = 2;\n');
    expect(await codeFingerprint_read([pkg])).not.toBe(before);
  });

  it('moves when the version changes', async () => {
    const before: string = await codeFingerprint_read([pkg]);
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@fnndsc/brasa', version: '0.32.0' }));
    expect(await codeFingerprint_read([pkg])).not.toBe(before);
  });

  it('holds when only file times change (a reinstall of the same version)', async () => {
    const before: string = await codeFingerprint_read([pkg]);
    const later: Date = new Date(Date.now() + 3_600_000);
    utimesSync(path.join(pkg, 'dist', 'core', 'a.js'), later, later);
    expect(await codeFingerprint_read([pkg])).toBe(before);
  });

  it('ignores what is not a compiled script', async () => {
    const before: string = await codeFingerprint_read([pkg]);
    writeFileSync(path.join(pkg, 'dist', 'core', 'a.js.map'), '{}');
    expect(await codeFingerprint_read([pkg])).toBe(before);
  });

  it('tells the watch each flip, and only the flip', async () => {
    const flips: boolean[] = [];
    const watch = await codeWatch_start((stale: boolean): void => { flips.push(stale); }, [pkg], 3_600_000);
    expect(await watch.check()).toBe(false);
    writeFileSync(path.join(pkg, 'dist', 'core', 'a.js'), 'export const a = 3;\n');
    expect(await watch.check()).toBe(true);
    expect(await watch.check()).toBe(true);
    writeFileSync(path.join(pkg, 'dist', 'core', 'a.js'), 'export const a = 1;\n');
    expect(await watch.check()).toBe(false);
    expect(flips).toEqual([true, false]);
    watch.stop();
  });
});

describe('daemonPackageRoots_find', () => {
  it('finds the daemon packages this checkout resolves', () => {
    const names: string[] = daemonPackageRoots_find(undefined).map((root: string): string => path.basename(root));
    expect(names).toEqual(expect.arrayContaining(['brasa', 'calypso', 'menu']));
  });
});
