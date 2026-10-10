/**
 * @file The command registry: every name the engine answers in-process, and the
 * handler that answers it.
 *
 * A command registers as an envelope handler (it returns its outcome as an
 * envelope) or a plain handler (it may print, and returns an envelope or
 * nothing). Dispatch, the capture path and the pipe's "is this a builtin" test
 * read the registry, never a table of their own. So do `help`, the `/bin`
 * builtin list and command completion, through the help a command registers.
 *
 * Handlers are kept in plain records and looked up by index, exactly as the
 * dispatch tables were: a name is a builtin when it is `in` a record. A record
 * inherits from `Object.prototype`, so a name such as `toString` counts as a
 * builtin too; that is how the tables behaved, and changing it is a decision of
 * its own, not a side effect of moving the lookup here.
 *
 * Listing order is kept explicitly (`commandOrder_set`), apart from which
 * group registered a name, so the core's and a backend's commands registering
 * separately do not reorder what the shell offers; an unlisted name lists
 * after, in registration order. A later registration of a name replaces the
 * earlier.
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/menu';

/** A builtin that returns its outcome as an envelope. */
export type EnvelopeHandler = (args: string[]) => Promise<CommandEnvelope>;

/** A builtin that may print, and returns an envelope or nothing. */
export type CommandHandler = (args: string[]) => Promise<void | CommandEnvelope>;

/** A command's help: what `help <name>` shows, and what the listings summarise. */
export interface CommandHelp {
  usage: string;
  /** One line for listings; the description stands in when there is none. */
  summary?: string;
  description: string;
  subcommands?: string[];
  options?: string[];
  examples?: string[];
}

/** A group of commands registered together. */
export interface CommandGroup {
  /** Commands answered by an envelope handler. */
  envelope?: Record<string, EnvelopeHandler>;
  /** Commands answered by a plain handler. */
  plain?: Record<string, CommandHandler>;
  /**
   * Help, by name. Its names are the builtins `/bin` lists and the shell
   * completes, in registration order.
   */
  help?: Record<string, CommandHelp>;
}

/** Who registers a group: the core, or the session's backend. */
export type CommandOwner = 'core' | 'backend';

/** The names the core registered, which no backend may take. */
const coreNames: Set<string> = new Set<string>();

const envelopeHandlers: Record<string, EnvelopeHandler> = {};
const plainHandlers: Record<string, CommandHandler> = {};
const helpEntries: Record<string, CommandHelp> = {};

/** The listing order, by kind; empty until set. */
const listingOrder: { envelope: string[]; plain: string[]; help: string[] } = { envelope: [], plain: [], help: [] };

/**
 * Every envelope handler registered, by name: the record the engine's
 * `ENVELOPE_HANDLERS` export names. Read through {@link envelopeHandler_get}.
 */
export const ENVELOPE_HANDLERS: Readonly<Record<string, EnvelopeHandler>> = envelopeHandlers;

/**
 * Every plain handler registered, by name: the record the engine's
 * `COMMAND_HANDLERS` export names. Read through {@link plainHandler_get}.
 */
export const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = plainHandlers;

/**
 * Sets the order names list in, by kind, apart from which group registered
 * them: a registered name in the order lists there, and any other after,
 * in registration order.
 *
 * @param order - The names, by kind, in listing order.
 */
export function commandOrder_set(order: { envelope?: string[]; plain?: string[]; help?: string[] }): void {
  if (order.envelope !== undefined) listingOrder.envelope = [...order.envelope];
  if (order.plain !== undefined) listingOrder.plain = [...order.plain];
  if (order.help !== undefined) listingOrder.help = [...order.help];
}

/**
 * A record's names in listing order: those the order names, in its order,
 * then the rest in registration order.
 *
 * @param record - The record.
 * @param order - The listing order.
 * @returns The names.
 */
function names_ordered(record: Record<string, unknown>, order: string[]): string[] {
  const registered: string[] = Object.keys(record);
  const present: Set<string> = new Set(registered);
  const listed: string[] = order.filter((name: string): boolean => present.has(name));
  const listedSet: Set<string> = new Set(listed);
  return [...listed, ...registered.filter((name: string): boolean => !listedSet.has(name))];
}

/**
 * Registers a group of commands. The core's come first; a backend's are
 * added beside them and may not replace one (a backend never overrides a
 * core command).
 *
 * @param group - The commands, by name, in the order they list.
 * @param owner - Whose commands they are: the core's, or a backend's.
 * @throws {Error} When a backend's group names a core command.
 */
export function commands_register(group: CommandGroup, owner: CommandOwner = 'core'): void {
  if (owner === 'backend') {
    const taken: string[] = [...Object.keys(group.envelope ?? {}), ...Object.keys(group.plain ?? {})]
      .filter((name: string): boolean => coreNames.has(name));
    if (taken.length > 0) throw new Error(`a backend cannot replace the core's commands: ${[...new Set(taken)].join(', ')}`);
  } else {
    for (const name of [...Object.keys(group.envelope ?? {}), ...Object.keys(group.plain ?? {})]) coreNames.add(name);
  }
  if (group.envelope !== undefined) Object.assign(envelopeHandlers, group.envelope);
  if (group.plain !== undefined) Object.assign(plainHandlers, group.plain);
  if (group.help !== undefined) Object.assign(helpEntries, group.help);
}

/**
 * The envelope handler a name reaches, by index (as the tables were read).
 *
 * @param name - The command name.
 * @returns The handler, or undefined.
 */
export function envelopeHandler_get(name: string): EnvelopeHandler | undefined {
  return envelopeHandlers[name];
}

/**
 * The plain handler a name reaches, by index (as the tables were read).
 *
 * @param name - The command name.
 * @returns The handler, or undefined.
 */
export function plainHandler_get(name: string): CommandHandler | undefined {
  return plainHandlers[name];
}

/**
 * Whether a name is answered in-process, by either kind of handler: the pipe's
 * test for running a segment in the engine rather than on the host.
 *
 * @param name - The command name.
 * @returns True when the name is `in` either record.
 */
export function builtinCommand_has(name: string): boolean {
  return name in envelopeHandlers || name in plainHandlers;
}

/** @returns The names answered by an envelope handler, in listing order. */
export function envelopeCommand_names(): string[] {
  return names_ordered(envelopeHandlers, listingOrder.envelope);
}

/** @returns The names answered by a plain handler, in listing order. */
export function plainCommand_names(): string[] {
  return names_ordered(plainHandlers, listingOrder.plain);
}

/**
 * A name's help, by index (as the help record was read).
 *
 * @param name - The command or topic name.
 * @returns The help, or undefined.
 */
export function commandHelpEntry_get(name: string): CommandHelp | undefined {
  return helpEntries[name];
}

/** @returns The names that have help, in listing order: `/bin`'s builtins and the shell's completions. */
export function helpTopic_names(): string[] {
  return names_ordered(helpEntries, listingOrder.help);
}
