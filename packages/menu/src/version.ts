/**
 * @file The wire-contract version and its compatibility rule.
 *
 * The contract version is carried by a client in the attach handshake and
 * refused by the daemon on mismatch, with no silent degradation. Per
 * `docs/calypso.adoc`, it tracks the calypso package's major version at
 * release; within a major, changes are additive only (new message types,
 * new optional fields, new model kinds), so a daemon tolerates unknown
 * additions from a newer minor but rejects a different major outright.
 *
 * @module
 */

/**
 * The wire-contract major version this build speaks.
 */
export const CONTRACT_VERSION: number = 1;

/**
 * Decides whether a client's declared contract version is compatible with
 * this build. Compatibility is exact-major: a client on a different major is
 * refused, because a major bump removes or re-types something.
 *
 * @param clientVersion - The contract major the client declared at attach.
 * @returns True when the client may attach.
 */
export function version_isCompatible(clientVersion: number): boolean {
  return clientVersion === CONTRACT_VERSION;
}
