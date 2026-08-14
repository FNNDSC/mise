/**
 * @file CUBE-local account command seam.
 * @module
 */
import {
  localAccount_action as salsa_localAccount_action,
  localAccount_adminAccessEnsure as salsa_localAccount_adminAccessEnsure,
  localAccount_create as salsa_localAccount_create,
  localAccount_find as salsa_localAccount_find,
  type LocalAccount,
  type LocalAccountAction,
  type Result,
} from '@fnndsc/salsa';

export type { LocalAccount, LocalAccountAction };

/**
 * Verifies that the current identity may use local-account administration.
 *
 * @returns Success when the active CUBE identity has account-admin access.
 */
export async function localAccount_adminAccessEnsure(): Promise<Result<void>> {
  return await salsa_localAccount_adminAccessEnsure();
}

/**
 * Creates one CUBE-local account.
 *
 * @param username - New local username.
 * @param email - Account email address.
 * @param password - Initial local-login password.
 * @returns The created account or an operation error.
 */
export async function localAccount_create(username: string, email: string, password: string): Promise<Result<LocalAccount>> {
  return await salsa_localAccount_create(username, email, password);
}

/**
 * Finds one CUBE-local account.
 *
 * @param username - Exact local username.
 * @returns The matching account or an operation error.
 */
export async function localAccount_find(username: string): Promise<Result<LocalAccount>> {
  return await salsa_localAccount_find(username);
}

/**
 * Changes one CUBE-local account lifecycle state.
 *
 * @param accountID - Stable local-account record identifier.
 * @param action - Lifecycle transition to apply.
 * @returns The updated account or an operation error.
 */
export async function localAccount_action(accountID: number, action: LocalAccountAction): Promise<Result<LocalAccount>> {
  return await salsa_localAccount_action(accountID, action);
}
