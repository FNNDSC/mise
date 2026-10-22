/**
 * @jest-environment jsdom
 */
/**
 * @file The stratus composition's tiles: DOMAINS from `domain status`, the
 * lead with a domain gone wrong in red, and CAPACITY from `capacity`,
 * teaching the line that names a family when there is none.
 */
import { describe, it, expect } from '@jest/globals';
import { limitShort_of, money_text, stratusTiles_make, zoneShort_of, type StratusTileHooks } from '../../src/compositions/stratus/tiles.js';
import type { ExecuteOutcome } from '../../src/calypso/client.js';

const DOMAINS = {
  domains: [
    { name: 'harbor', path: '/net/oci/t/domains/harbor', cluster: 'harbor.oci.example.org', lastDone: '09-run', steps: [{ folder: '03-iso', state: 'expired' }, { folder: '09-run', state: 'done' }], resources: { instances: 3 }, cost: { hourly: 0.6213, soFar: 210, currency: 'USD' } },
    { name: 'lab', path: '/net/oci/t/domains/lab', cluster: null, lastDone: null, steps: [{ folder: '01-preflight', state: 'unknown' }], resources: null },
  ],
};
const CAPACITY = {
  region: 'us-ashburn-1',
  rows: [
    { family: 'E5', limit: 'standard-e5-core-count', zone: 'disG:US-ASHBURN-AD-1', value: 4629, used: 4, available: 4625 },
    { family: 'E5', limit: 'standard-e5-memory-count', zone: null, value: 100, used: null, available: null },
    { family: 'E5', limit: 'standard-e5-core-count', zone: 'disG:US-ASHBURN-AD-2', value: 10, used: 10, available: 0 },
  ],
};

/** The hooks, answering each line with a model or an error, and recording what was asked and opened. */
function hooks_make(answers: Record<string, unknown>, seen: string[]): StratusTileHooks {
  return {
    ask: async (line: string): Promise<ExecuteOutcome> => {
      const kind: string = line.startsWith('domain') ? 'stratus.domains' : 'stratus.capacity';
      const data: unknown = answers[line];
      return (data === undefined
        ? { envelopes: [{ status: 'error', rendered: '', renderedErr: `${line}: refused\n` }] }
        : { envelopes: [{ status: 'ok', rendered: '', model: { kind, data } }] }) as unknown as ExecuteOutcome;
    },
    home_cd: (path: string): void => { seen.push(`cd ${path}`); },
    home_open: (): void => { seen.push('home'); },
    line_run: (line: string): void => { seen.push(`run ${line}`); },
  };
}

describe('the stratus tiles', () => {
  it('lead with DOMAINS: each domain\'s last step and cluster, red where a step went wrong, opening its folder', async () => {
    const seen: string[] = [];
    const tiles = await stratusTiles_make(hooks_make({ 'domain status': DOMAINS, capacity: CAPACITY }, seen))();
    const domains = tiles.lead!.tile;
    expect(tiles.lead!.weight).toBe(2);
    expect(domains.figures.map((f) => [f.text, f.errored ?? false])).toEqual([['2 DOMAINS', false], ['1 NEEDS A LOOK', true], ['$0.62/H', false]]);
    expect(domains.rows.map((r) => [r.text, r.errored])).toEqual([['harbor  09-run  $0.62/h  harbor.oci.example.org', true], ['lab  NOTHING DONE', false]]);
    expect(money_text(1, 'EUR')).toBe('EUR 1.00');
    domains.rows[0]!.open!();
    domains.enter();
    expect(seen).toEqual(['cd /net/oci/t/domains/harbor', 'home']);
    expect(tiles.about?.['files']?.text).toContain('Trusted Domains');
  });

  it('place CAPACITY after FILES: per zone, free of permitted, red where nothing is free', async () => {
    const seen: string[] = [];
    const tiles = await stratusTiles_make(hooks_make({ 'domain status': DOMAINS, capacity: CAPACITY }, seen))();
    const capacity = tiles.afterFiles[0]!;
    expect(capacity.figures).toEqual([{ text: 'US-ASHBURN-1' }]);
    expect(capacity.rows.map((r) => [r.text, r.errored])).toEqual([
      ['E5  US-ASHBURN-AD-1  core  4625 / 4629 FREE', false],
      ['E5  REGION  memory  100 PERMITTED', false],
      ['E5  US-ASHBURN-AD-2  core  0 / 10 FREE', true],
    ]);
    capacity.rows[0]!.open!();
    capacity.enter();
    expect(seen).toEqual(['run capacity E5', 'run capacity']);
  });

  it('say NONE with no domains, and teach the capacity line with no family', async () => {
    const seen: string[] = [];
    const tiles = await stratusTiles_make(hooks_make({ 'domain status': { domains: [] } }, seen))();
    expect(tiles.lead!.tile.figures).toEqual([{ text: 'NONE' }]);
    const capacity = tiles.afterFiles[0]!;
    expect(capacity.figures).toEqual([{ text: 'NO FAMILY' }]);
    capacity.rows[0]!.open!();
    expect(seen).toEqual(['run capacity E5']);
    const refused = await stratusTiles_make(hooks_make({}, []))();
    expect(refused.lead!.weight).toBe(0);
  });

  it('shortens zones and limits to what a tile has room for', () => {
    expect(zoneShort_of('disG:US-ASHBURN-AD-1')).toBe('US-ASHBURN-AD-1');
    expect(zoneShort_of('us-east-1a')).toBe('us-east-1a');
    expect(zoneShort_of(null)).toBe('REGION');
    expect(limitShort_of({ family: 'A1', limit: 'standard-a1-memory-count', zone: null, value: 1, used: null, available: null })).toBe('memory');
    expect(limitShort_of({ family: 'GPU', limit: 'gpu-a10-count', zone: null, value: 1, used: null, available: null })).toBe('a10');
  });
});
