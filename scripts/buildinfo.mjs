/**
 * @file Build metadata generator.
 *
 * Writes `dist/buildinfo.json` in the invoking package, carrying the first six
 * characters of the git commit hash the build was produced from. Runs as the
 * final step of a package build (after tsc), so the compiled output always
 * knows which commit it came from; published tarballs include the file because
 * it lives inside `dist`. Outside a git checkout (a source tarball, a vendored
 * copy) the hash is recorded as "unknown" rather than failing the build.
 *
 * @module
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let buildHash = 'unknown';
try {
  buildHash = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    .trim()
    .slice(0, 6);
} catch {
  // Not a git checkout: keep the "unknown" marker.
}

const distDir = path.resolve(process.cwd(), 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(path.join(distDir, 'buildinfo.json'), `${JSON.stringify({ hash: buildHash })}\n`);
