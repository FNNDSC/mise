/**
 * @file The stratus command line refuses unknown words by name.
 */
import { describe, it, expect } from '@jest/globals';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { domainArg_parse, stratusArgs_parse } from '../src/args.js';

describe('stratusArgs_parse', () => {
  it('takes the profile, config, region, fake and help, in both flag forms', () => {
    expect(stratusArgs_parse([])).toEqual({ args: { profile: undefined, configFile: undefined, region: undefined, fake: false, help: false, domains: [] } });
    expect(stratusArgs_parse(['--profile', 'BCH', '--region=us-phoenix-1', '--config', '/x/config', '--fake', '-h'])).toEqual({
      args: { profile: 'BCH', configFile: '/x/config', region: 'us-phoenix-1', fake: true, help: true, domains: [] },
    });
    expect(stratusArgs_parse(['--host-control', '--expose-host-control', '--help'])).toMatchObject({ args: { help: true } });
    expect(stratusArgs_parse(['--host-control=shell,files'])).toMatchObject({ args: { fake: false } });
  });

  it('refuses an unknown word by name', () => {
    expect(stratusArgs_parse(['--tenancy', 'x'])).toEqual({ error: "unknown option '--tenancy' (stratus --help)" });
    expect(stratusArgs_parse(['--region=us-ashburn-1', '--bogus=1'])).toEqual({ error: "unknown option '--bogus=1' (stratus --help)" });
  });

  it('takes --domain as many times as given, in both forms, ~ as home', () => {
    expect(stratusArgs_parse(['--domain', 'harbor=~/src/harbor-oci', '--domain=lab=/srv/lab', '--fake'])).toMatchObject({
      args: { fake: true, domains: [{ name: 'harbor', root: join(homedir(), 'src/harbor-oci') }, { name: 'lab', root: '/srv/lab' }] },
    });
    expect(domainArg_parse('home=~')).toEqual({ name: 'home', root: homedir() });
    expect(domainArg_parse('rel=checkout')).toEqual({ name: 'rel', root: resolve('checkout') });
  });

  it('refuses a --domain that is not <name>=<checkout>', () => {
    for (const bad of ['harbor', '=x', 'harbor=', 'a/b=x', '.hidden=x']) expect(domainArg_parse(bad)).toBeNull();
    expect(stratusArgs_parse(['--domain', 'harbor'])).toEqual({ error: "--domain takes <name>=<harbor-oci checkout>, not 'harbor'" });
    expect(stratusArgs_parse(['--domain'])).toEqual({ error: "--domain takes <name>=<harbor-oci checkout>, not ''" });
    expect(stratusArgs_parse(['--domain=x'])).toEqual({ error: "--domain takes <name>=<harbor-oci checkout>, not 'x'" });
  });
});
