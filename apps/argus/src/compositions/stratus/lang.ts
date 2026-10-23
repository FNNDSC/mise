/**
 * @file The stratus composition's words in the ARGUS language: `domain`
 * opens the TD controller (docs/stratus.adoc, D13).
 *
 * `domain` is the session's command too. The surface claims only bare
 * `domain` and `domain <name>` for a domain the session has, the lines the
 * controller opens on; every other `domain` line (`domain status`, `domain
 * plan quay`, `domain build quay`) reaches the session as it always did, and
 * in chell the same lines play as text.
 *
 * @module
 */
import type { ArgusHost, LanguageExtension } from '../../console/argusLang.js';

/** The stratus verbs the surface's host answers, beside the frame's. */
export interface StratusHostVerbs {
  /** Opens the TD controller on a domain (`''` for the first); answers what happened. */
  controller_open(name: string): Promise<string>;
}

/** The host the stratus words reach. */
export type StratusLangHost = ArgusHost & StratusHostVerbs;

/**
 * The words of `domain` the surface claims: bare, and each domain's name as
 * the session's reads find them. Held by reference in the language's claims,
 * so a name added here is claimed at once.
 */
export const DOMAIN_CLAIMS: Set<string> = new Set<string>(['']);

/**
 * Claims the domains' names, so `domain <name>` opens the controller on one.
 *
 * @param names - The domains the session has.
 * @returns True when the claims changed (the daemon is told them again).
 */
export function domainClaims_set(names: ReadonlyArray<string>): boolean {
  const next: Set<string> = new Set<string>(['', ...names]);
  if (next.size === DOMAIN_CLAIMS.size && [...next].every((name: string): boolean => DOMAIN_CLAIMS.has(name))) return false;
  DOMAIN_CLAIMS.clear();
  for (const name of next) DOMAIN_CLAIMS.add(name);
  return true;
}

/**
 * The stratus composition's extension of the language.
 *
 * @param host - The surface, read when a sentence runs.
 * @returns The extension.
 */
export function stratusLanguage(host: () => StratusLangHost): LanguageExtension {
  return {
    subjects: { domain: DOMAIN_CLAIMS },
    views: {},
    claims: {},
    listings: {},
    chords: [],
    lines: [{ after: 'view', line: 'domain [<name>]             (the TD controller takes the screen; every other domain line is the session\'s)' }],
    run: (_argus: ArgusHost, sentence: { subject: string; words: string[] }): Promise<string> | undefined => {
      if (sentence.subject !== 'domain') return undefined;
      return host().controller_open(sentence.words[0] ?? '');
    },
  };
}
