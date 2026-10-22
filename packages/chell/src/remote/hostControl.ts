/**
 * @file What a daemon's host-control tiers mean, as a remote shell's attach
 * banner says them (docs/session-supervisor.adoc, "Host control").
 *
 * @module
 */

/** What each host-control tier hands the daemon, as the attach banner says it. */
const HOST_CONTROL_WORDS: Readonly<Record<string, string>> = {
  shell: "`!` runs on calypso's host",
  pipes: "pipes run on calypso's host",
  files: 'upload/download reach ITS disk',
  tasks: 'jobs may change the cloud and bill',
};

/**
 * What a daemon's host-control tiers mean, in the order given.
 *
 * @param tiers - The tiers the attach ack carried.
 * @returns The phrase.
 */
export function hostControl_phrase(tiers: ReadonlyArray<string>): string {
  return tiers.map((tier: string): string => HOST_CONTROL_WORDS[tier] ?? tier).join(', ');
}
