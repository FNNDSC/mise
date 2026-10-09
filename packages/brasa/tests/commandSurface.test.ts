/**
 * @file The command surface does not move: every in-process command name, the
 * `/bin` builtin list and every help page match the committed record.
 *
 * The record (commandSurface/commandSurface.json) is generated from brasa's
 * build output in a plain Node process (commandSurface/generate.mjs). It guards
 * the refactor of how commands are registered (docs/backend-neutral.adoc,
 * step 4): whatever replaces the dispatch tables must reproduce it exactly.
 * CI builds before it tests; locally the test skips when brasa is unbuilt.
 */
import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here: string = join(process.cwd(), 'tests', 'commandSurface');
const built: boolean = existsSync(join(process.cwd(), 'dist', 'core', 'dispatch.js'));
if (!built && process.env['CI'] !== undefined) throw new Error('commandSurface: brasa is not built; CI must build before testing');

(built ? describe : describe.skip)('the command surface [built dist]', () => {
  it('matches the committed record: in-process names, /bin builtins, every help page', () => {
    const home: string = mkdtempSync(join(tmpdir(), 'brasa-surface-'));
    try {
      const out: string = execFileSync('node', [join(here, 'generate.mjs')], {
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, FORCE_COLOR: '1', XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache') },
      });
      const now: Record<string, unknown> = JSON.parse(out) as Record<string, unknown>;
      const recorded: Record<string, unknown> = JSON.parse(readFileSync(join(here, 'commandSurface.json'), 'utf8')) as Record<string, unknown>;
      expect(now['envelopeCommands']).toEqual(recorded['envelopeCommands']);
      expect(now['plainCommands']).toEqual(recorded['plainCommands']);
      expect(now['commandKeysList']).toEqual(recorded['commandKeysList']);
      expect(now['binBuiltins']).toEqual(recorded['binBuiltins']);
      expect(now['help']).toEqual(recorded['help']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);
});
