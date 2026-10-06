/**
 * @file Unit tests for the pure cliConfig_fromArgs derivation.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { cliConfig_fromArgs } from '../src/core/cli.js';

const noFile = () => false;
const anyFile = () => true;

describe('cliConfig_fromArgs', () => {
  it('defaults to interactive with no args', () => {
    expect(cliConfig_fromArgs(undefined, {}, noFile)).toEqual({ mode: 'interactive', physicalFS: undefined });
  });

  it('--file => script mode with stopOnError from -e', () => {
    const c = cliConfig_fromArgs(undefined, { file: 's.chell', e: true }, noFile);
    expect(c.mode).toBe('script');
    expect(c.scriptFile).toBe('s.chell');
    expect(c.stopOnError).toBe(true);
  });

  it('--command => execute mode', () => {
    const c = cliConfig_fromArgs(undefined, { command: 'ls' }, noFile);
    expect(c.mode).toBe('execute');
    expect(c.commandToExecute).toBe('ls');
  });

  it('auto-detects an existing target file as a script', () => {
    const c = cliConfig_fromArgs('run.chell', {}, anyFile);
    expect(c.mode).toBe('script');
    expect(c.scriptFile).toBe('run.chell');
  });

  it('connect mode from a url, prepending http and parsing user@url', () => {
    const c = cliConfig_fromArgs('chris@cube.example.org', { password: 'pw' }, noFile);
    expect(c.mode).toBe('connect');
    expect(c.connectConfig).toEqual({ user: 'chris', password: 'pw', url: 'http://cube.example.org' });
  });

  it('keeps an explicit https url', () => {
    const c = cliConfig_fromArgs('https://secure.org', { user: 'u' }, noFile);
    expect(c.connectConfig?.url).toBe('https://secure.org');
  });

  it('takes a door with -u and -p, needing no user@url target', () => {
    const c = cliConfig_fromArgs(undefined, { remote: true, door: 'https://titan/', user: 'chris', password: 'pw' }, noFile);
    expect(c.mode).toBe('remote');
    expect(c.door).toBe('https://titan/');
    expect(c.connectConfig).toEqual({ user: 'chris', password: 'pw' });
    const bare = cliConfig_fromArgs(undefined, { remote: true, door: 'https://titan/' }, noFile);
    expect(bare.connectConfig).toEqual({});
  });

  it('carries --auth-token-stdin beside the identity, and without one', () => {
    const withIdentity = cliConfig_fromArgs('chris@https://cube.example.org/api/v1/', { daemon: true, authTokenStdin: true }, noFile);
    expect(withIdentity.mode).toBe('daemon');
    expect(withIdentity.authTokenStdin).toBe(true);
    expect(withIdentity.connectConfig).toEqual({ user: 'chris', password: undefined, url: 'https://cube.example.org/api/v1/' });
    // The flag survives a target-less invocation so the boot can refuse it by name.
    const alone = cliConfig_fromArgs(undefined, { daemon: true, authTokenStdin: true }, noFile);
    expect(alone.authTokenStdin).toBe(true);
    expect(alone.connectConfig).toBeUndefined();
  });

  it('carries --saved-token beside the identity, so a porter can restart a session without the password', () => {
    const c = cliConfig_fromArgs('chris@https://cube.example.org/api/v1/', { daemon: true, savedToken: true }, noFile);
    expect(c.mode).toBe('daemon');
    expect(c.savedToken).toBe(true);
    expect(c.authTokenStdin).toBeUndefined();
    expect(c.connectConfig).toEqual({ user: 'chris', password: undefined, url: 'https://cube.example.org/api/v1/' });
  });

  it('applies startup preference toggles', () => {
    const c = cliConfig_fromArgs(undefined, { prefetchFeeds: false, logo: false, asciiBoot: true }, noFile);
    expect(c.prefetchFeeds).toBe(false);
    expect(c.showLogo).toBe(false);
    expect(c.asciiBoot).toBe(true);
  });

  it('carries the identity into remote mode when a user@url target is given', () => {
    const c = cliConfig_fromArgs('chris@https://cube.example.org/api/v1/', { remote: true }, noFile);
    expect(c.mode).toBe('remote');
    expect(c.connectConfig).toEqual({ user: 'chris', password: undefined, url: 'https://cube.example.org/api/v1/' });
  });

  it('retains a one-shot command in remote mode', () => {
    const c = cliConfig_fromArgs(
      'chris@https://cube.example.org/api/v1/',
      { remote: true, command: 'pwd' },
      noFile,
    );
    expect(c.mode).toBe('remote');
    expect(c.commandToExecute).toBe('pwd');
  });

  it('leaves remote mode without a connectConfig for a bare --remote', () => {
    const c = cliConfig_fromArgs(undefined, { remote: true }, noFile);
    expect(c).toEqual({ mode: 'remote', connectConfig: undefined });
  });
});

describe('the default door', () => {
  const door = (): string | null => 'https://titan.tch.harvard.edu/';
  const none = (): string | null => null;

  it('a bare chell and a chell -c with no target go through the default door, carrying -e, -u and -p', () => {
    expect(cliConfig_fromArgs(undefined, {}, noFile, door)).toEqual({ mode: 'remote', door: 'https://titan.tch.harvard.edu/', physicalFS: undefined });
    expect(cliConfig_fromArgs(undefined, { command: 'ls /proc/jobs', e: true }, noFile, door)).toEqual({ mode: 'remote', door: 'https://titan.tch.harvard.edu/', physicalFS: undefined, commandToExecute: 'ls /proc/jobs', stopOnError: true });
    expect(cliConfig_fromArgs(undefined, { command: 'pwd', user: 'chris', password: 'pw' }, noFile, door)).toMatchObject({ mode: 'remote', connectConfig: { user: 'chris', password: 'pw' } });
  });

  it('a target, --no-door, a script, a daemon and --remote are never re-routed', () => {
    expect(cliConfig_fromArgs('chris@cube.example.org', {}, noFile, door).mode).toBe('connect');
    expect(cliConfig_fromArgs(undefined, { noDoor: true }, noFile, door)).toEqual({ mode: 'interactive', physicalFS: undefined });
    expect(cliConfig_fromArgs(undefined, { noDoor: true, command: 'pwd' }, noFile, door).mode).toBe('execute');
    expect(cliConfig_fromArgs(undefined, { file: 's.chell' }, noFile, door).mode).toBe('script');
    expect(cliConfig_fromArgs(undefined, { daemon: true }, noFile, door).mode).toBe('daemon');
    expect(cliConfig_fromArgs(undefined, { remote: true, door: 'https://other/', command: 'pwd', e: true }, noFile, door)).toMatchObject({ mode: 'remote', door: 'https://other/', stopOnError: true });
  });

  it('with no default door nothing changes', () => {
    expect(cliConfig_fromArgs(undefined, {}, noFile, none)).toEqual({ mode: 'interactive', physicalFS: undefined });
    expect(cliConfig_fromArgs(undefined, { command: 'pwd' }, noFile, none).mode).toBe('execute');
  });
});
