/**
 * @file command (#1104): the system program of a name, not the builtin; the
 * line goes to the host shell whole, reading what was piped in.
 */
import { describe, it, expect } from '@jest/globals';
import { builtin_command } from '../src/builtins/sys/command.js';
import { stdin_set } from '../src/builtins/games/stdin.js';
import { listingIn_set } from '../src/core/listing.js';
import { surface_get, surface_set } from '../src/core/surface.js';

describe('command', () => {
  it('hands the line to the host shell with the piped text, and drops a piped listing', async () => {
    const seen: Array<{ line: string; input: string }> = [];
    const base = surface_get();
    const host = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      capabilities: { ...base.capabilities, pipeSegments: true },
      pipeSegment: async (line: string, input: Buffer): Promise<Buffer> => { seen.push({ line, input: input.toString('utf-8') }); return Buffer.from('T1 SAG\n'); },
    });
    const previous = surface_set(host);
    try {
      stdin_set('T1 SAG\nT2 AX\n');
      listingIn_set({ kind: 'pacs.query', data: {} });
      const envelope = await builtin_command(['grep', '-i', 't1', 'a b']);
      expect(envelope.rendered).toBe('T1 SAG\n');
      expect(seen).toEqual([{ line: "command grep -i t1 'a b'", input: 'T1 SAG\nT2 AX\n' }]);
    } finally {
      surface_set(previous);
    }
  });

  it('refuses with no program, or on a surface with no host programs', async () => {
    expect((await builtin_command([])).status).toBe('error');
    const envelope = await builtin_command(['grep', 'x']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr ?? '').toContain('cannot run system programs');
  });
});
