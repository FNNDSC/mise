/**
 * @file What a feed row in the runs roster can be told to do, and what it
 * reads out when indicated, as the host wires it.
 *
 * Each verb lowers to the command the operator could have typed. NOTE opens
 * the feed's note in the editor (`edit /proc/jobs/feed_N/note`); the note is
 * read then, never for the roster (CUBE's feed list says nothing about notes:
 * docs/CUBE-gaps.adoc). TAG asks which tags to hang; the × on a tag mark
 * takes it off. `setfacl` grants to an identity on a FEED, so the roster is
 * where sharing belongs; DELETE is the kernel's own removal, which asks
 * before it acts. Who holds a feed is a readout, not a verb.
 *
 * A module of the host: the host hands in the console line and the tag verbs.
 */
import type { FeedListEntry } from '@fnndsc/menu';
import type { ExecuteOutcome } from '../calypso/client.js';
import type { ListingAction } from '../features/roster/row.js';
import { RUNS_ROW_ROSTER, type RunsRowFacts } from '../features/roster/verbs.js';
import { shares_read } from './browser.js';
import type { HostContext } from './hostContext.js';
import type { TagVerbs } from './tags.js';

/** The handlers a runs roster's rows take. */
export interface FeedRowHandlers {
  feed_verbs: (feed: FeedListEntry) => ReadonlyArray<ListingAction<FeedListEntry>>;
  feed_indicated: (feed: FeedListEntry) => void;
  feed_untag: (feedId: number, tag: string) => void;
  feed_entered: (feedId: number) => void;
  feed_note: (feedId: number) => void;
  feed_tag: (feedId: number, worn: ReadonlyArray<string>) => void;
}

/**
 * A feed's tags, from a silent `getfattr`'s model.
 *
 * @param outcome - What the command returned.
 * @returns The tag names; empty when none were read.
 */
export function feedTags_of(outcome: ExecuteOutcome): string[] {
  for (const envelope of outcome.envelopes) {
    if (envelope.model?.kind !== 'fs.xattr') continue;
    const blocks = envelope.model.data as Array<{ tags?: unknown }>;
    return (blocks[0]?.tags as string[] | undefined) ?? [];
  }
  return [];
}

/**
 * Builds a roster's row handlers.
 *
 * @param context - The panels, the subjects, the console and the wire.
 * @param id - The DAG pane the roster stands in.
 * @param tags - The tag verbs.
 * @returns The handlers.
 */
export function feedRowHandlers_make(context: Pick<HostContext, 'panels' | 'subjects' | 'terminal' | 'client'>, id: string, tags: TagVerbs): FeedRowHandlers {
  const { panels, subjects } = context;
  return {
    feed_verbs: (feed: FeedListEntry): ReadonlyArray<ListingAction<FeedListEntry>> => {
      const facts: RunsRowFacts = { feedId: feed.id };
      const runs: Record<string, () => void> = {
        note: (): void => context.terminal.line_run(`edit /proc/jobs/feed_${feed.id}/note`),
        tag: (): void => { void tags.tag_choose(id, feed.id, feed.tags ?? []); },
        share: (): void => context.terminal.line_run(`setfacl feed_${feed.id}`),
        delete: (): void => context.terminal.line_run(`feed rm feed_${feed.id}`),
      };
      return RUNS_ROW_ROSTER.rules
        .filter((rule): boolean => rule.offered(facts))
        .map((rule) => ({ label: rule.label(facts), run: (): void => runs[rule.name]?.() }));
    },
    feed_indicated: (feed: FeedListEntry): void => {
      subjects.regard_write(id, { address: `/proc/jobs/feed_${feed.id}`, modelKind: 'feed' });
      void context.client
        .line_execute(`getfacl feed_${feed.id}`, { silent: true, observe: false })
        .then((outcome: ExecuteOutcome): void => { panels.get('dag', id)?.rowReadout_show(feed.id, shares_read(outcome)); })
        .catch((): void => { panels.get('dag', id)?.rowReadout_show(feed.id, 'ACCESS UNREAD'); });
    },
    feed_untag: (feedId: number, tag: string): void => { void tags.tag_remove(feedId, tag); },
    // A feed entered reads its note (CUBE says nothing about notes in a
    // list, so this is the one place it is read) and its tags, quietly.
    feed_entered: (feedId: number): void => {
      const quiet = { silent: true, observe: false };
      void Promise.all([
        context.client.line_execute(`cat /proc/jobs/feed_${feedId}/note`, quiet).catch((): null => null),
        context.client.line_execute(`getfattr feed_${feedId}`, quiet).catch((): null => null),
      ]).then(([note, held]: [ExecuteOutcome | null, ExecuteOutcome | null]): void => {
        const read: boolean = note !== null && note.envelopes.every((envelope): boolean => envelope.status === 'ok');
        panels.get('dag', id)?.feedMarks_show(feedId, {
          note: read && note !== null ? note.envelopes.map((envelope): string => envelope.rendered).join('').replace(/\x1b\[[0-9;]*m/g, '') : null,
          tags: held === null ? [] : feedTags_of(held),
        });
      });
    },
    feed_note: (feedId: number): void => context.terminal.line_run(`edit /proc/jobs/feed_${feedId}/note`),
    feed_tag: (feedId: number, worn: ReadonlyArray<string>): void => { void tags.tag_choose(id, feedId, worn); },
  };
}
