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

  it('applies startup preference toggles', () => {
    const c = cliConfig_fromArgs(undefined, { prefetchFeeds: false, logo: false, asciiBoot: true }, noFile);
    expect(c.prefetchFeeds).toBe(false);
    expect(c.showLogo).toBe(false);
    expect(c.asciiBoot).toBe(true);
  });
});
