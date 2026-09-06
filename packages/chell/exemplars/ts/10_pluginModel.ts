/**
 * @file Exemplar 10 — a plugin is data, and the manual is a projection of it.
 *
 * A plugin's substance used to exist only as a rendered manual: `cat
 * /bin/<entry>` scraped CUBE and printed a table, and that table was
 * everything any surface could have. This proves the model now carries it.
 *
 * Four properties, and the second is the one that needs a live CUBE rather
 * than a mock:
 *
 * 1. `plugin info` answers with a typed model — identity, authoring facts,
 *    and parameters carrying the flag an operator actually types.
 * 2. The parameter list is COMPLETE, checked against the count the server
 *    itself reports. The single-page `{ limit: 100 }` this replaces dropped
 *    the tail of any larger plugin and said nothing. The drain across page
 *    boundaries is pinned in cumin's unit tests; what a live CUBE adds is
 *    agreement with the server's OWN count, which a client that both fetches
 *    and counts can never give itself. Set `CUBE_PLUGIN_ENTRY` to aim this
 *    at a specific plugin (the largest one a CUBE registers, say).
 * 3. `cat /bin/<entry>` prints the same facts — the manual is one projection
 *    of the model, not a second scrape that can disagree with it.
 * 4. An entry naming no version is refused BY NAME rather than guessed at.
 *
 * Read-only throughout: nothing is created, so nothing needs cleaning up.
 *
 *   node exemplars/ts/dist/10_pluginModel.js
 *
 * @module
 */
import {
  plugin_find,
  type Client,
  type CommandEnvelope,
  type ListPage,
  type PluginFound,
  type PluginParameterData,
} from '@fnndsc/cumin';
import { command_dispatchEnvelope, engine_create } from '@fnndsc/brasa';
import { pluginInfoModelSchema, type PluginInfoModel, type PluginParameter } from '@fnndsc/menu';
import {
  env_load, config_isolate, cube_connect, connection_active, check, section,
  summary_exit, CubeEnv,
} from './lib/harness.js';

/** One row of a `/bin` listing, as the `fs.listing` model carries it. */
interface BinItem {
  name?: unknown;
  type?: unknown;
}

/**
 * Runs a line through the kernel — the same entry chell uses.
 *
 * @param command - The command word.
 * @param args - Its arguments.
 * @returns The envelope.
 */
function line_run(command: string, args: string[]): Promise<CommandEnvelope> {
  return command_dispatchEnvelope(command, args);
}

/**
 * Picks a plugin entry out of `/bin`, preferring the one whose name suggests
 * the most parameters is not knowable in advance — so the first versioned
 * plugin entry is taken, and CUBE_PLUGIN_ENTRY pins a specific one.
 *
 * @returns The `/bin` basename of a registered plugin, or null.
 */
async function pluginEntry_pick(): Promise<string | null> {
  const pinned: string | undefined = process.env.CUBE_PLUGIN_ENTRY;
  if (pinned !== undefined && pinned !== '') return pinned;

  const envelope: CommandEnvelope = await line_run('ls', ['/bin']);
  const listings: unknown = envelope.model?.data;
  if (!Array.isArray(listings)) return null;
  for (const listing of listings as Array<{ items?: unknown }>) {
    const items: unknown = listing.items;
    if (!Array.isArray(items)) continue;
    for (const item of items as BinItem[]) {
      const name: unknown = item.name;
      if (item.type !== 'plugin' || typeof name !== 'string') continue;
      if (name.lastIndexOf('-v') > 0) return name;
    }
  }
  return null;
}

/**
 * Asks CUBE how many parameters a plugin declares, without reading them.
 *
 * The server's own count is the only honest yardstick for completeness: a
 * client that both fetches and counts can agree with itself while being
 * wrong.
 *
 * @param name - Exact plugin name.
 * @param version - Exact plugin version.
 * @returns The declared total, or null when the server sends none.
 */
async function parameterTotal_ask(name: string, version: string): Promise<number | null> {
  const client: Client | null = await connection_active().client_get();
  if (!client) return null;
  const found: PluginFound | null = await plugin_find(client, name, version);
  if (found === null) return null;
  const page: ListPage<PluginParameterData> = await found.handle.parametersPage_get({ limit: 1, offset: 0 });
  return page.totalCount;
}

async function main(): Promise<void> {
  const env: CubeEnv = env_load();
  config_isolate();

  section('authenticate');
  const token: string = await cube_connect(env);
  check('received an auth token', token.length > 0);
  // `/bin` is a VFS provider the engine registers; a bare dispatch would
  // find no such directory.
  await engine_create();

  section('find a registered plugin in /bin');
  const entry: string | null = await pluginEntry_pick();
  check('/bin lists at least one versioned plugin', entry !== null);
  if (entry === null) summary_exit();
  console.log(`    (reading ${entry})`);
  const cut: number = entry.lastIndexOf('-v');
  const name: string = entry.substring(0, cut);
  const version: string = entry.substring(cut + 2);

  section('the plugin arrives as a model');
  const envelope: CommandEnvelope = await line_run('plugin', ['info', entry]);
  check('the envelope carries a plugin.info model', envelope.model?.kind === 'plugin.info');
  const parsed = pluginInfoModelSchema.safeParse(envelope.model?.data);
  check('and the model parses against the published schema', parsed.success);
  if (!parsed.success) summary_exit();
  const model: PluginInfoModel = parsed.data;
  check('it names the plugin the entry addresses', model.name === name && model.version === version);
  check('it states what the plugin is (ds, fs or ts)', model.type.length > 0);
  check('it names the /bin command that runs it', model.command === entry);
  check(
    'every parameter carries the flag an operator types',
    model.parameters.every((parameter: PluginParameter): boolean =>
      parameter.flag.length > 0 && parameter.name.length > 0 && parameter.type.length > 0),
  );

  section('the parameter list is complete, by the server\'s own count');
  const total: number | null = await parameterTotal_ask(name, version);
  check('CUBE reports how many parameters the plugin declares', total !== null);
  console.log(`    (server says ${total ?? '?'}, model carries ${model.parameters.length})`);
  check(
    'the model carries every one of them, not the first page',
    total === null || model.parameters.length === total,
  );

  section('the manual is a projection of the model');
  const manual: CommandEnvelope = await line_run('cat', [`/bin/${entry}`]);
  const text: string = manual.rendered ?? '';
  check('cat prints the plugin manual', text.includes(model.name.toUpperCase()));
  const last: PluginParameter | undefined = model.parameters[model.parameters.length - 1];
  if (last !== undefined) {
    // The parameter the old truncation would have lost first is the last one.
    check('and it prints the LAST parameter, not a hundred of them', text.includes(last.flag));
  } else {
    check('a plugin declaring no parameters still renders a manual', text.length > 0);
  }

  section('an entry naming no version is refused by name');
  const refused: CommandEnvelope = await line_run('plugin', ['info', name]);
  check('the ask fails rather than guessing a version', refused.status === 'error');
  check(
    'and it says which entry it could not read',
    (refused.renderedErr ?? '').includes(name),
  );

  summary_exit();
}

void main();
