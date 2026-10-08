/**
 * @file The color file is read once and its absence said once (#966), and the published package carries it.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { colorConfigLoader_make, COLOR_CONFIG_FALLBACK } from '../src/config/colorConfigLoad';

const packageRoot: string = path.resolve(__dirname, '..');

describe('colorConfigLoader_make', () => {
  it('reads the package\'s colors.yml once and keeps it, warning about nothing', () => {
    const warnings: string[] = [];
    const load = colorConfigLoader_make(path.join(packageRoot, 'config', 'colors.yml'), (message: string): void => { warnings.push(message); });
    const first = load();
    expect(first.fileTypes.dir).toBeDefined();
    expect(load()).toBe(first);
    expect(warnings).toEqual([]);
  });

  it('with the file missing, warns once per process, not once per call, and keeps the fallback', () => {
    const warnings: string[] = [];
    const load = colorConfigLoader_make(path.join(packageRoot, 'config', 'no-such-colors.yml'), (message: string): void => { warnings.push(message); });
    expect(load()).toBe(COLOR_CONFIG_FALLBACK);
    load();
    load();
    load();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Could not load color config: .*ENOENT/);
  });
});

describe('the published package', () => {
  it('carries config/colors.yml (npm pack lists it), where the loader looks for it', () => {
    const out: string = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const packed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    const files: string[] = (packed[0]?.files ?? []).map((file: { path: string }): string => file.path);
    expect(files).toContain('config/colors.yml');
  }, 60_000);
});
