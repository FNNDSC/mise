/**
 * @file The command surface, as built: every name the engine answers in-process,
 * the `/bin` builtin list (which also feeds tab completion), and every help page.
 *
 * Run in a plain Node process against brasa's build output, with no mocks, so
 * what it records is what a user meets. Prints JSON to stdout.
 *
 * The record is the guard for refactoring how commands are registered
 * (docs/backend-neutral.adoc, step 4): whatever replaces the dispatch tables
 * must reproduce this file byte for byte. When the generator has to read a new
 * structure, change the generator, never the record; a deliberate change to the
 * command surface regenerates the record in its own reviewed change:
 *
 *   FORCE_COLOR=1 node packages/brasa/tests/commandSurface/generate.mjs \
 *     > packages/brasa/tests/commandSurface/commandSurface.json
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
// Loading dispatch registers the engine's commands; the registry then answers.
const dispatch = await import(join(dist, 'core', 'dispatch.js'));
const registry = await import(join(dist, 'core', 'commandRegistry.js'));
const help = await import(join(dist, 'builtins', 'help.js'));

/** Names the engine answers through an envelope handler, in registration order. */
const envelopeCommands = registry.envelopeCommand_names();
/** Names the engine answers through a plain command handler, in registration order. */
const plainCommands = registry.plainCommand_names();

// Every help page a builtin name, a help topic, or the shelf can show. `help
// notes` is left out: it renders the installed release notes, which change
// with every release by design.
const topics = new Set([...Object.keys(help.helpText), ...envelopeCommands, ...plainCommands, 'games']);
topics.delete('notes');
const pages = {};
pages[''] = (await help.builtin_help([])).rendered;
for (const topic of [...topics].sort()) {
  pages[topic] = (await help.builtin_help(topic.split(' '))).rendered;
}

const record = {
  envelopeCommands,
  plainCommands,
  commandKeysList: dispatch.COMMAND_HANDLERS_KEYS,
  binBuiltins: help.builtinCommands_list(),
  help: pages,
};
// Exit only once the write has flushed: a pipe takes it in pieces, and an
// early exit cut the record off mid-string. Exit at all because the modules
// imported here leave timers running.
process.stdout.write(`${JSON.stringify(record, null, 2)}\n`, () => process.exit(0));
