import { describe, it, expect } from '@jest/globals';
import { helpText, RESOURCE_LIST_OPTIONS } from '../src/builtins/help.js';
import { COMMAND_HANDLERS_KEYS } from '../src/command-keys.js';

/**
 * Resources that must implement the full Resource Contract:
 * list, search, inspect via RESOURCE_LIST_OPTIONS.
 */
const RESOURCE_COMMANDS = [
  'plugins', 'feeds', 'files', 'links', 'dirs',
  'pipeline', 'compute',
  'tags', 'groups', 'pluginmetas', 'plugininstances', 'workflows',
];

/**
 * All command keys that must be registered in COMMAND_HANDLERS.
 */
const EXPECTED_HANDLERS = [
  // filesystem
  'cd', 'pwd', 'ls', 'cat', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'tree', 'du',
  'upload', 'download', 'pull', 'chefs',
  // net
  'connect', 'logout', 'pacs', 'query', 'cubepath',
  // sys
  'context', 'physicalmode', 'prompt', 'timing', 'whoami', 'whereami', 'debug', 'help',
  // resources — canonical
  'plugin', 'plugins', 'feed', 'feeds',
  'pipeline', 'pipelines',
  'compute', 'computes',
  'files', 'links', 'dirs',
  'store',
  'tag', 'tags',
  'group', 'groups',
  'pluginmeta', 'pluginmetas', 'meta', 'metas',
  'plugininstance', 'plugininstances', 'instance', 'instances', 'job', 'jobs',
  'workflow', 'workflows',
  'parametersofplugin',
];

describe('RESOURCE_LIST_OPTIONS', () => {
  it('contains standard subcommands', () => {
    const joined = RESOURCE_LIST_OPTIONS.join('\n');
    expect(joined).toContain('list');
    expect(joined).toContain('search');
    expect(joined).toContain('inspect');
  });

  it('contains standard options', () => {
    const joined = RESOURCE_LIST_OPTIONS.join('\n');
    expect(joined).toContain('--all');
    expect(joined).toContain('--limit');
    expect(joined).toContain('--fields');
    expect(joined).toContain('--sort');
    expect(joined).toContain('--table');
    expect(joined).toContain('--csv');
  });
});

describe('helpText resource entries', () => {
  it('every resource command has a help entry', () => {
    for (const cmd of RESOURCE_COMMANDS) {
      expect(helpText[cmd]).toBeDefined();
    }
  });

  it('every resource help entry injects RESOURCE_LIST_OPTIONS', () => {
    for (const cmd of RESOURCE_COMMANDS) {
      const entry = helpText[cmd];
      if (!entry?.options) continue;
      const joined = entry.options.join('\n');
      expect(joined).toContain('--all');
      expect(joined).toContain('--limit');
      expect(joined).toContain('inspect');
    }
  });

  it('no resource entry still uses "fieldslist"', () => {
    for (const [cmd, entry] of Object.entries(helpText)) {
      if (!RESOURCE_COMMANDS.includes(cmd)) continue;
      const text = [...(entry.options ?? []), ...(entry.examples ?? [])].join('\n');
      expect(text).not.toContain('fieldslist');
    }
  });

  it('[admin] marker present on privileged subcommands', () => {
    const adminCommands: Record<string, string[]> = {
      plugins: ['add', 'delete'],
      groups: ['create', 'delete', 'adduser', 'removeuser'],
    };
    for (const [cmd, subs] of Object.entries(adminCommands)) {
      const entry = helpText[cmd];
      const text = (entry?.options ?? []).join('\n');
      for (const sub of subs) {
        expect(text).toContain(`[admin]`);
        expect(text).toContain(sub);
      }
    }
  });
});

describe('COMMAND_HANDLERS_KEYS wiring', () => {
  it('contains all expected handler keys', () => {
    for (const key of EXPECTED_HANDLERS) {
      expect(COMMAND_HANDLERS_KEYS).toContain(key);
    }
  });

  it('job/jobs are registered', () => {
    expect(COMMAND_HANDLERS_KEYS).toContain('job');
    expect(COMMAND_HANDLERS_KEYS).toContain('jobs');
  });

  it('meta/metas aliases are registered', () => {
    expect(COMMAND_HANDLERS_KEYS).toContain('meta');
    expect(COMMAND_HANDLERS_KEYS).toContain('metas');
  });

  it('instance/instances aliases are registered', () => {
    expect(COMMAND_HANDLERS_KEYS).toContain('instance');
    expect(COMMAND_HANDLERS_KEYS).toContain('instances');
  });
});
