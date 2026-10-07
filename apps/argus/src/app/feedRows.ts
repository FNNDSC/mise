/**
 * @file What a feed row in the runs roster can be told to do, and what it
 * reads out when indicated, as the host wires it.
 *
 * Each verb lowers to the command the operator could have typed. NOTE opens
 * the feed's note in the editor (`edit /proc/jobs/feed_N/note`); the note is
 * read then, never for the roster (CUBE's feed list says nothing about notes:
 * docs/CUBE-gaps.adoc). TAG asks which tags to hang; the × on a tag mark
 * takes it off. RENAME asks for the feed's name. `setfacl` grants to an
 * identity on a FEED, so the roster is where sharing belongs: SHARE asks with
 * whom, and who holds the feed are marks on the indicated row, each × asking
 * before it withdraws. DELETE is the kernel's own removal, which asks before
 * it acts.
 *
 * A module of the host: the host builds the feed verbs once
 * (`feedVerbs_wire`) and hands them to every roster.
 */
import type { FeedListEntry } from '@fnndsc/menu';
import type { ExecuteOutcome } from '../calypso/client.js';
import type { ListingAction } from '../features/roster/row.js';
import { RUNS_ROW_ROSTER, type RunsRowFacts } from '../features/roster/verbs.js';
import { access_wire, type AccessHooks, type AccessVerbs, type FeedHolders } from './access.js';
import type { HostContext } from './hostContext.js';
import { tags_wire, type TagVerbs } from './tags.js';

/** The verbs every roster's rows run: a feed's tags, and its name and access. */
export interface FeedVerbs {
  tags: TagVerbs;
  access: AccessVerbs;
}

/**
 * Builds the feed verbs once for the host.
 *
 * @param context - The console and the wire.
 * @param hooks - The pane question, the session's user, and what to refresh when a feed changed.
 * @returns The verbs.
 */
export function feedVerbs_wire(context: Pick<HostContext, 'terminal' | 'client'>, hooks: AccessHooks): FeedVerbs {
  return {
    tags: tags_wire(context, { ask_onPane: hooks.ask_onPane, tags_changed: hooks.changed }),
    access: access_wire(context, hooks),
  };
}

/** The handlers a runs roster's rows take. */
export interface FeedRowHandlers {
  feed_verbs: (feed: FeedListEntry) => ReadonlyArray<ListingAction<FeedListEntry>>;
  feed_indicated: (feed: FeedListEntry) => void;
  feed_untag: (feedId: number, tag: string) => void;
  feed_entered: (feedId: number) => void;
  feed_note: (feedId: number) => void;
  feed_tag: (feedId: number, worn: ReadonlyArray<string>) => void;
  feed_rename: (feedId: number, title: string) => void;
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
 * @param verbs - The feed verbs.
 * @returns The handlers.
 */
export function feedRowHandlers_make(context: Pick<HostContext, 'panels' | 'subjects' | 'terminal' | 'client'>, id: string, verbs: FeedVerbs): FeedRowHandlers {
  const { panels, subjects } = context;
  const { tags, access } = verbs;
  return {
    feed_verbs: (feed: FeedListEntry): ReadonlyArray<ListingAction<FeedListEntry>> => {
      const facts: RunsRowFacts = { feedId: feed.id };
      const runs: Record<string, () => void> = {
        note: (): void => context.terminal.line_run(`edit /proc/jobs/feed_${feed.id}/note`),
        tag: (): void => { void tags.tag_choose(id, feed.id, feed.tags ?? []); },
        rename: (): void => { void access.rename(id, feed.id, feed.title); },
        share: (): void => { void access.share_choose(id, feed.id); },
        delete: (): void => context.terminal.line_run(`feed rm feed_${feed.id}`),
      };
      return RUNS_ROW_ROSTER.rules
        .filter((rule): boolean => rule.offered(facts))
        .map((rule) => ({ label: rule.label(facts), run: (): void => runs[rule.name]?.() }));
    },
    feed_indicated: (feed: FeedListEntry): void => {
      subjects.regard_write(id, { address: `/proc/jobs/feed_${feed.id}`, modelKind: 'feed' });
      // Who holds it is a readout: a mark per holder, each × withdrawing its grant.
      void access.holders_read(feed.id).then((holders: FeedHolders | null): void => {
        panels.get('dag', id)?.rowReadout_show(feed.id, holders === null ? 'ACCESS UNREAD' : access.holders_build(id, feed.id, holders));
      });
    },
    feed_untag: (feedId: number, tag: string): void => { void tags.tag_remove(feedId, tag); },
    // A feed entered reads its note (CUBE says nothing about notes in a
    // list, so this is the one place it is read) and its tags, quietly.
    feed_entered: (feedId: number): void => {
      const quiet = { silent: true, observe: false };
      const text_of = (outcome: ExecuteOutcome | null): string | null =>
        outcome !== null && outcome.envelopes.every((envelope): boolean => envelope.status === 'ok')
          ? outcome.envelopes.map((envelope): string => envelope.rendered).join('').replace(/\x1b\[[0-9;]*m/g, '')
          : null;
      void Promise.all([
        context.client.line_execute(`cat /proc/jobs/feed_${feedId}/note`, quiet).catch((): null => null),
        context.client.line_execute(`getfattr feed_${feedId}`, quiet).catch((): null => null),
        context.client.line_execute(`cat /proc/jobs/feed_${feedId}/title`, quiet).catch((): null => null),
      ]).then(([note, held, title]: [ExecuteOutcome | null, ExecuteOutcome | null, ExecuteOutcome | null]): void => {
        // The pane that asked: a RUNS pane, or a universe inside the feed.
        (panels.get('dag', id) ?? panels.get('universe', id))?.feedMarks_show(feedId, {
          note: text_of(note),
          tags: held === null ? [] : feedTags_of(held),
          title: (text_of(title) ?? '').trim(),
        });
      });
    },
    feed_note: (feedId: number): void => context.terminal.line_run(`edit /proc/jobs/feed_${feedId}/note`),
    feed_tag: (feedId: number, worn: ReadonlyArray<string>): void => { void tags.tag_choose(id, feedId, worn); },
    feed_rename: (feedId: number, title: string): void => { void access.rename(id, feedId, title); },
  };
}
