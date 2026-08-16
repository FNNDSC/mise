/**
 * @file CUBE-local account administration builtin.
 *
 * This is a targeted control-plane command rather than a ChRIS Resource
 * Command: federated identities remain outside its authority.
 *
 * @module
 */
import chalk from 'chalk';
import { errorStack, envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/cumin';
import { table_render } from '@fnndsc/chili/screen/screen.js';
import {
  localAccount_action,
  localAccount_adminAccessEnsure,
  localAccount_create,
  localAccount_find,
  type LocalAccount,
  type LocalAccountAction,
} from '@fnndsc/chili/commands/users/local.js';
import { surface_get } from '../../core/surface.js';
import { authorizationFailure_is, sudoHint_build } from '../../core/elevation.js';

/**
 * Renders a local-account command error and records a failing process status.
 *
 * @param message - User-facing error text.
 * @returns Error envelope for the active command surface.
 */
function user_error(message: string): CommandEnvelope {
  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(message)}\n`);
}

/**
 * Renders an account-operation failure, including elevation guidance when apt.
 *
 * @param verb - Failed local-account operation.
 * @param username - Target local username.
 * @returns Error envelope for the active command surface.
 */
function user_operationError(verb: string, username: string): CommandEnvelope {
  const detail = errorStack.stack_pop()?.message ?? `user ${verb} failed.`;
  const hint = authorizationFailure_is(detail) ? sudoHint_build(`user ${verb}`, [username]) : '';
  return user_error(`${detail}\n${hint}`);
}

/**
 * Renders one local account as a stable, operator-oriented table.
 *
 * @param account - Local account returned by CUBE.
 * @returns Success envelope containing the rendered account.
 */
function user_render(account: LocalAccount): CommandEnvelope {
  return envelope_ok(table_render([{ ...account }], ['id', 'username', 'email', 'is_active', 'disabled_at', 'removed_at']));
}

/**
 * Handles targeted local-account lifecycle commands.
 *
 * @param args - Parsed command arguments beginning with an account operation.
 * @returns Envelope containing a local-account result or operation error.
 */
export async function builtin_user(args: string[]): Promise<CommandEnvelope> {
  const [verb, username] = args;
  if (verb === 'add' || verb === 'inspect' || verb === 'disable' || verb === 'enable' || verb === 'remove') {
    if (!username) return user_error(`Usage: user ${verb} <username>`);
    const access = await localAccount_adminAccessEnsure();
    if (!access.ok) return user_operationError(verb, username);
  }
  if (verb === 'add') {
    const surface = surface_get();
    if (!surface.capabilities.hiddenInput) return user_error('user add: this surface cannot securely collect a password.');
    const email = await surface.prompt({ message: 'Email address: ' });
    const password = await surface.prompt({ message: 'New password: ', hidden: true });
    const confirmation = await surface.prompt({ message: 'Retype new password: ', hidden: true });
    if (password !== confirmation) return user_error('user add: passwords do not match.');
    const result = await localAccount_create(username, email, password);
    return result.ok ? user_render(result.value) : user_operationError('add', username);
  }
  if (verb === 'inspect') {
    const result = await localAccount_find(username);
    return result.ok ? user_render(result.value) : user_error(errorStack.stack_pop()?.message ?? `No CUBE-local account named '${username}'.`);
  }
  if (verb === 'disable' || verb === 'enable' || verb === 'remove') {
    const found = await localAccount_find(username);
    if (!found.ok) return user_error(errorStack.stack_pop()?.message ?? `No CUBE-local account named '${username}'.`);
    const action: LocalAccountAction = verb;
    const result = await localAccount_action(found.value.id, action);
    return result.ok ? user_render(result.value) : user_operationError(verb, username);
  }
  return user_error('Usage: user <add|inspect|disable|enable|remove> ...');
}
