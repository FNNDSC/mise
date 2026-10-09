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
 * Registration order is listing order: names are kept in the order they were
 * registered, and a later registration of the same name replaces the earlier.
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/cumin';

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

const envelopeHandlers: Record<string, EnvelopeHandler> = {};
const plainHandlers: Record<string, CommandHandler> = {};
const helpEntries: Record<string, CommandHelp> = {};

/**
 * Registers a group of commands.
 *
 * @param group - The commands, by name, in the order they list.
 */
export function commands_register(group: CommandGroup): void {
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

/** @returns The names answered by an envelope handler, in registration order. */
export function envelopeCommand_names(): string[] {
  return Object.keys(envelopeHandlers);
}

/** @returns The names answered by a plain handler, in registration order. */
export function plainCommand_names(): string[] {
  return Object.keys(plainHandlers);
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

/** @returns The names that have help, in registration order: `/bin`'s builtins and the shell's completions. */
export function helpTopic_names(): string[] {
  return Object.keys(helpEntries);
}
