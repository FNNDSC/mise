/**
 * @file Canonical list of all registered command keys in COMMAND_HANDLERS.
 *
 * Kept separate from chell.ts so tests can verify wiring without importing
 * the full application entry point and all its transitive dependencies.
 * Must stay in sync with COMMAND_HANDLERS in chell.ts.
 */

export const COMMAND_HANDLERS_KEYS: string[] = [
  // filesystem
  'cd', 'pwd', 'ls', 'cat', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'tree', 'du',
  'upload', 'download', 'pull',
  // net
  'connect', 'logout', 'pacs', 'query', 'cubepath',
  // sys
  'context', 'physicalmode', 'prompt', 'timing', 'whoami', 'whereami', 'debug', 'help',
  // resources — canonical + aliases
  'plugin', 'plugins',
  'feed', 'feeds',
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
  // pacs delegation
  'pacsservers', 'pacsqueries', 'pacsretrieve',
];
