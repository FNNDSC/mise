/**
 * @file Reading a `chell --remote <target>` into the berth identities to try.
 *
 * Berths are keyed by the identity string a backend gives, so the target is
 * matched as typed before it is read as a CUBE URL.
 *
 * @module
 */
import { identity_normalise } from '@fnndsc/calypso';

/**
 * The identities a `--remote <target>` may name, in the order to try them.
 *
 * A daemon keys its berth by the identity its backend gave, written exactly:
 * `chris@https://cube.example.org/api/v1/` for a CUBE, `rudolph@fnndsc` for a
 * cloud tenancy, `rudolph.pienaar@childrens.harvard.edu@fnndsc-bch` when the
 * cloud user is an e-mail address. The target is tried as typed first; only
 * then, when the part after the last `@` reads as a host, as a normalised
 * CUBE identity, so `chris@cube.example.org` still finds
 * `chris@http://cube.example.org`.
 *
 * @param target - The target as typed on the command line.
 * @returns The candidate identities, most exact first, without repeats; empty
 *   when the target names no user.
 */
export function berthIdentities_derive(target: string): string[] {
  const split: number = target.lastIndexOf('@');
  if (split <= 0 || split === target.length - 1) {
    return [];
  }
  const user: string = target.slice(0, split);
  const where: string = target.slice(split + 1);
  const candidates: string[] = [target];
  const asUrl: string = /^[a-z][a-z0-9+.-]*:\/\//i.test(where) ? where : `http://${where}`;
  let readsAsHost: boolean = false;
  try {
    readsAsHost = new URL(asUrl).hostname.length > 0;
  } catch {
    readsAsHost = false;
  }
  if (readsAsHost) {
    const normalised: string = identity_normalise(user, asUrl);
    if (!candidates.includes(normalised)) {
      candidates.push(normalised);
    }
  }
  return candidates;
}
