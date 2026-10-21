/**
 * @file The stratus command line refuses unknown words by name.
 */
import { describe, it, expect } from '@jest/globals';
import { stratusArgs_parse } from '../src/args.js';

describe('stratusArgs_parse', () => {
  it('takes the profile, config, region, fake and help, in both flag forms', () => {
    expect(stratusArgs_parse([])).toEqual({ args: { profile: undefined, configFile: undefined, region: undefined, fake: false, help: false } });
    expect(stratusArgs_parse(['--profile', 'BCH', '--region=us-phoenix-1', '--config', '/x/config', '--fake', '-h'])).toEqual({
      args: { profile: 'BCH', configFile: '/x/config', region: 'us-phoenix-1', fake: true, help: true },
    });
    expect(stratusArgs_parse(['--host-control', '--expose-host-control', '--help'])).toMatchObject({ args: { help: true } });
    expect(stratusArgs_parse(['--host-control=shell,files'])).toMatchObject({ args: { fake: false } });
  });

  it('refuses an unknown word by name', () => {
    expect(stratusArgs_parse(['--tenancy', 'x'])).toEqual({ error: "unknown option '--tenancy' (stratus --help)" });
    expect(stratusArgs_parse(['--region=us-ashburn-1', '--bogus=1'])).toEqual({ error: "unknown option '--bogus=1' (stratus --help)" });
  });
});
