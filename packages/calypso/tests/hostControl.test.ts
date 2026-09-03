/**
 * @file Host control: parsing, the bind guard, the readout, and the host
 * runners.
 */
import { describe, it, expect } from '@jest/globals';
import {
  HOST_CONTROL_OFF,
  hostControl_fromInputs,
  hostControl_parseArgv,
  hostControl_guard,
  hostControl_describe,
  hostControl_tiers,
  hostShell_run,
  hostPipe_run,
} from '../src/daemon/hostControl.js';

describe('hostControl_fromInputs', () => {
  it('is off by default, all tiers when bare, the listed tiers otherwise', () => {
    expect(hostControl_fromInputs({})).toEqual({ policy: { tiers: new Set(), exposed: false } });
    const bare = hostControl_fromInputs({ flag: true });
    expect('policy' in bare && hostControl_tiers(bare.policy)).toEqual(['shell', 'files', 'pipes']);
    const some = hostControl_fromInputs({ flag: 'files,shell' });
    expect('policy' in some && hostControl_tiers(some.policy)).toEqual(['shell', 'files']);
  });
  it('the flag wins over the env twin; the env alone counts; unknown words refuse', () => {
    const env = hostControl_fromInputs({ env: 'pipes' });
    expect('policy' in env && hostControl_tiers(env.policy)).toEqual(['pipes']);
    const both = hostControl_fromInputs({ flag: 'shell', env: 'pipes' });
    expect('policy' in both && hostControl_tiers(both.policy)).toEqual(['shell']);
    expect(hostControl_fromInputs({ flag: 'shell,root' })).toEqual({ error: "unknown host-control tier 'root' (shell, files, pipes, or all)" });
  });
  it('parses a raw argv for the standalone binary', () => {
    const bare = hostControl_parseArgv(['node', 'calypso', '--host-control'], {});
    expect('policy' in bare && hostControl_tiers(bare.policy)).toEqual(['shell', 'files', 'pipes']);
    const eq = hostControl_parseArgv(['node', 'calypso', '--host-control=files', '--expose-host-control'], {});
    expect('policy' in eq && eq.policy).toEqual({ tiers: new Set(['files']), exposed: true });
    const spaced = hostControl_parseArgv(['node', 'calypso', '--host-control', 'pipes', '--berths'], {});
    expect('policy' in spaced && hostControl_tiers(spaced.policy)).toEqual(['pipes']);
  });
});

describe('hostControl_guard', () => {
  const on = { tiers: new Set(['shell'] as const), exposed: false };
  it('needs nothing on loopback or when off', () => {
    expect(hostControl_guard(on, '127.0.0.1')).toBeNull();
    expect(hostControl_guard(HOST_CONTROL_OFF, '0.0.0.0')).toBeNull();
  });
  it('refuses a network bind unless the override was typed', () => {
    expect(hostControl_guard(on, '0.0.0.0')).toContain('--expose-host-control');
    expect(hostControl_guard({ ...on, exposed: true }, '0.0.0.0')).toBeNull();
  });
});

describe('the readout and the runners', () => {
  it('describes tiers in canonical order', () => {
    expect(hostControl_describe({ tiers: new Set(['pipes', 'shell'] as const), exposed: false })).toBe('shell pipes');
    expect(hostControl_describe(HOST_CONTROL_OFF)).toBe('');
  });
  it('runs a shell command on the host, streaming both channels, and returns its exit code', async () => {
    const out: Array<[string, string]> = [];
    const code: number = await hostShell_run('echo out; echo err 1>&2; exit 3', (channel, chunk): void => { out.push([channel, chunk.trim()]); });
    expect(code).toBe(3);
    expect(out).toEqual(expect.arrayContaining([['data', 'out'], ['err', 'err']]));
  });
  it('runs a pipe segment on the host with the input on stdin', async () => {
    const output: Buffer = await hostPipe_run('tr a-z A-Z', Buffer.from('hello'));
    expect(output.toString('utf8')).toBe('HELLO');
  });
});
