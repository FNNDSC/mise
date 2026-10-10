/**
 * @file The session's cohort: ONE per session, the session's rather than
 * any pane's — it spans PACS series and will span directories, so it cannot
 * live in whichever pane started it. The header band shows it; a GATHER
 * pane on the main panel can show the same one at the same time. The band
 * and the pane are two reflections of one set, and their handlers are one
 * set of handlers, parameterised by where the work lands and where a
 * question stands.
 *
 * A module of the host: the host hands in its open verbs, its asks and its
 * stage as hooks; the module keeps the cohort, the band's panel and the
 * session file it is kept in.
 */
import type { PaneAskRequest } from '../features/ask/paneAsk.js';
import { question_stand } from './asks.js';
import { Cohort } from '../features/gather/cohort.js';
import { GatherPanel, type GatherFeed, type GatherPanelHandlers, type GatherSeries } from '../features/gather/panel.js';
import type { ExecuteOutcome } from '../calypso/client.js';
import type { CatalogueBinding, ReplayPlace } from './desktop.js';
import type { HostContext } from './hostContext.js';
import type { FileText } from './nodeOverlay.js';
import { paneInstance_dispose, type PaneInstance, type PaneKind } from './panes.js';

/**
 * Where the session keeps the cohort it is working on. A cohort belongs to
 * the SESSION, so it outlives the page: a refresh keeps it, and a second
 * surface attached to the same session sees the same one. A working file,
 * not a format — SAVE still writes the named manifest beside it.
 */
export const COHORT_FILE: string = '~/gather/current.json';

/** Writes are debounced: gathering a study is twenty changes, one file. */
export const COHORT_WRITE_MS: number = 1200;

/** What the cohort asks of the host. */
export interface CohortHooks {
  image_open: (fromId: string, path: string) => Promise<string>;
  process_open: (fromId: string, binding: CatalogueBinding) => void;
  feed_open: (fromId: string, feedId: number) => void;
  /** A question on a pane, where the press was. */
  ask_onPane: (id: string, request: PaneAskRequest) => Promise<string | null>;
  /** A pane on stage where the band's work lands; null when none stands. */
  errandHost_find: () => string | null;
  instance_spawn: (kind: PaneKind, inheritFrom?: string) => PaneInstance;
  birth_record: (childId: string, parent: string, dir: 'row' | 'col', before: boolean) => void;
  /** The split a replayed open must use; null in normal use. */
  replayPlace_get: () => ReplayPlace | null;
  stage_relight: () => void;
  home_apply: () => void;
  orphans_dispose: () => void;
  fileText_fetch: (path: string) => Promise<FileText>;
  template_stamp: (templateId: string) => HTMLElement;
  pane_find: (mount: HTMLElement, selector: string) => HTMLElement;
  element_require: (id: string) => HTMLElement;
}

/** The cohort verbs a wired host has. */
export interface CohortModule {
  /** The set itself, which neither view owns. */
  cohort: Cohort<GatherSeries>;
  /** Builds a GATHER pane showing the session's cohort. */
  instance_build: (id: string) => PaneInstance;
  /** Whether the band holds a series. */
  has: (seriesUID: string) => boolean;
  /** Takes series into the session's cohort; the band reveals itself the first time. */
  gather: (entries: ReadonlyArray<GatherSeries>) => void;
  /** Gathers into the GATHER pane on stage, opening one beside the host when there is none. */
  open: (entries: ReadonlyArray<GatherSeries>, host?: string) => string | null;
  /** Puts the cohort on the main panel as a pane; the band retracts. */
  stage: () => void;
  /** The header block says whether the session is holding anything. */
  annunciate: () => void;
  /** Reads back the cohort the session was working on, at boot. */
  restore: () => Promise<void>;
}

/**
 * Wires the cohort to a host.
 *
 * @param context - The layout, the panels, the subjects, the console and the wire.
 * @param hooks - The host's open verbs, asks and stage.
 * @returns The cohort verbs.
 */
export function cohort_wire(context: Pick<HostContext, 'layout' | 'panels' | 'subjects' | 'terminal' | 'client'>, hooks: CohortHooks): CohortModule {
  const { panels, subjects } = context;
  const cohort: Cohort<GatherSeries> = new Cohort<GatherSeries>();
  /** The band's panel, built the first time something is gathered. */
  let header: GatherPanel | null = null;
  /** Whether the operator sent the band away since the last gather. */
  let bandDismissed: boolean = false;
  let write: number | null = null;

  /**
   * The cohort's feed is made by the line the operator could have typed:
   * echoed, run, its answer written; the kernel's model names the feed and
   * the root a run appends to.
   */
  const feed_create = async (line: string): Promise<GatherFeed | null> => {
    const { terminal, client } = context;
    terminal.line_echo(line);
    let outcome: ExecuteOutcome;
    try {
      outcome = await client.line_execute(line, { silent: true });
    } catch (error: unknown) {
      terminal.output_write('err', `\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
      return null;
    }
    terminal.outcome_write(outcome);
    for (const envelope of outcome.envelopes) {
      if (envelope.model?.kind !== 'feed.created') continue;
      const data = envelope.model.data as { feedId?: unknown; rootInstanceId?: unknown; path?: unknown };
      if (typeof data.feedId === 'number' && typeof data.rootInstanceId === 'number' && typeof data.path === 'string') {
        return { feedId: data.feedId, rootInstanceId: data.rootInstanceId, path: data.path };
      }
    }
    return null;
  };

  /**
   * The handlers both reflections share, parameterised by where the work
   * lands (`hostOf`), how a question is asked, and what DISMISS and a change
   * mean for that reflection.
   */
  const handlers_make = (
    hostOf: () => string,
    asks: Pick<GatherPanelHandlers, 'name_ask' | 'confirm_ask'>,
    own: Pick<GatherPanelHandlers, 'changed' | 'dismiss'>,
  ): GatherPanelHandlers => ({
    command_run: (line: string): void => { void context.client.line_execute(line, { silent: true }); },
    command_show: (line: string): void => context.terminal.line_run(line),
    note: (text: string): void => context.terminal.line_note(text),
    image_open: (folderPath: string): void => {
      void hooks.image_open(hostOf(), folderPath).then((line: string): void => context.terminal.line_note(line));
    },
    process_open: (folderPath: string): void => hooks.process_open(hostOf(), { input: folderPath, feed: null, node: null }),
    ...asks,
    ...own,
    feed_create,
    cohort_process: (binding: { input: string; feed: number; node: number }): void => hooks.process_open(hostOf(), binding),
    feed_open: (feedId: number): void => hooks.feed_open(hostOf(), feedId),
  });

  /** Holds the cohort as the session's, after the surface changed it. */
  const keep = (): void => {
    if (write !== null) window.clearTimeout(write);
    write = window.setTimeout((): void => {
      write = null;
      const held: ReadonlyArray<GatherSeries> = header?.entries_get() ?? [];
      const kept: string = JSON.stringify({
        version: 1,
        name: header?.name_get() ?? null,
        feed: header?.feed_get() ?? null,
        series: held,
      });
      // Silent: this is the surface keeping its own state, not an act the
      // operator took, and the transcript is for what they did.
      // The folder first: touch makes no folders, as on a disk.
      void context.client.line_execute('mkdir -p ~/gather', { silent: true, observe: false })
        .then(() => context.client.line_execute(
          `touch --withContents '${kept.replace(/'/g, "'\\''")}' ${COHORT_FILE}`,
          { silent: true, observe: false },
        ));
    }, COHORT_WRITE_MS);
  };

  /**
   * The block says whether the session is holding anything, and no more. A
   * plate is a NAME — `01-GATHER`, as `02-CALYPSO` is — so the count does
   * not get glued to it; how many, and which, the face itself says.
   */
  const annunciate = (): void => {
    const pill: HTMLElement | null = document.querySelector<HTMLElement>('#header-gather-pill');
    if (pill === null) return;
    pill.classList.toggle('panel-gather-empty', (header?.entries_get().length ?? 0) === 0);
  };

  /**
   * Builds the cohort into the header's third face. Its handlers are the
   * pane's, with the two that were about a pane made honest: a cohort in
   * the band has no pane to close, so DISMISS sends the face away instead
   * (and forgets nothing), and what it opens lands in the BODY — on a pane
   * actually on stage, resolved at the press, not when the band was built.
   */
  const header_build = (): GatherPanel => {
    const face: HTMLElement = hooks.element_require('header-gather');
    const host = (): string => hooks.errandHost_find() ?? 'pacs';
    // The question stands where the press was, and the press was in the
    // BAND; the console still records the exchange.
    // The question stands where the press was — the BAND — and on the
    // console's line as well; either answers it (#826).
    const askOnBand = (request: PaneAskRequest): Promise<string | null> =>
      question_stand(context.terminal, hooks.element_require('header-gather'), request);
    return new GatherPanel(face, hooks.pane_find(face, '.gather-rows'), handlers_make(host, {
      name_ask: (suggest: string): Promise<string | null> => askOnBand({ message: 'Cohort name: ', kind: 'text', suggest, commit: 'NAME IT' }),
      confirm_ask: async (message: string): Promise<'y' | 'n' | null> => {
        const answered: string | null = await askOnBand({ message, kind: 'confirm' });
        return answered === 'y' || answered === 'n' ? answered : null;
      },
    }, {
      changed: (): void => {
        hooks.stage_relight();
        annunciate();
        keep();
      },
      dismiss: (): void => {
        document.body.dataset['header'] = 'away';
        bandDismissed = true;
        annunciate();
      },
    }), cohort);
  };

  const instance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = hooks.template_stamp('tpl-pane-gather');
    const panel: GatherPanel = new GatherPanel(mount, hooks.pane_find(mount, '.gather-rows'), handlers_make((): string => id, {
      name_ask: (suggest: string): Promise<string | null> => hooks.ask_onPane(id, { message: 'Cohort name: ', kind: 'text', suggest, commit: 'NAME IT' }),
      // On the pane, where the press was: CLEAR asks before throwing away
      // a cohort that was never saved.
      confirm_ask: async (message: string): Promise<'y' | 'n' | null> => {
        const answered: string | null = await hooks.ask_onPane(id, { message, kind: 'confirm' });
        return answered === 'y' || answered === 'n' ? answered : null;
      },
    }, {
      changed: (): void => hooks.stage_relight(),
      dismiss: (): void => {
        if (!context.layout.leaf_close(id)) hooks.home_apply();
        hooks.orphans_dispose();
        hooks.stage_relight();
      },
    }), cohort);
    panels.set('gather', id, panel);
    return {
      id,
      kind: 'gather',
      mount,
      dispose: (): void => {
        panels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  const restore = async (): Promise<void> => {
    const read: FileText = await hooks.fileText_fetch(COHORT_FILE);
    if (!read.ok) return;
    try {
      const held = JSON.parse(read.text) as { series?: unknown };
      if (!Array.isArray(held.series) || held.series.length === 0) return;
      if (header === null) header = header_build();
      for (const entry of held.series as GatherSeries[]) header.series_add(entry);
      annunciate();
      hooks.stage_relight();
    } catch {
      // A working file the operator may have edited: a cohort that cannot
      // be read is not a reason to refuse the session.
    }
  };

  /**
   * A band is right for reading and curating; a cohort of two hundred
   * members with a filter on wants a whole field. It is the SAME cohort —
   * nothing is copied and nothing can drift. The band retracts as it goes.
   */
  const stage = (): void => {
    const { layout } = context;
    const shown: Set<string> = new Set(layout.panes_shown());
    const standing: string | null = panels.ids('gather').find((id: string): boolean => shown.has(id)) ?? null;
    if (standing !== null) {
      layout.focus_set(standing);
    } else {
      const host: string = hooks.errandHost_find() ?? 'pacs';
      const spawned: PaneInstance = hooks.instance_spawn('gather', 'pacs');
      if (!layout.leaf_split(host, 'col', spawned.id, false)) {
        paneInstance_dispose(spawned.id);
        layout.mount_remove(spawned.id);
        return;
      }
      hooks.birth_record(spawned.id, host, 'col', false);
      panels.get('gather', spawned.id)?.render_now();
    }
    document.body.dataset['header'] = 'away';
    bandDismissed = true;
  };

  /**
   * The band reveals itself the first time, so the operator sees where the
   * thing they gathered went; after they have deliberately sent it away it
   * stays away and only the count moves, until they open it again.
   */
  const gather = (entries: ReadonlyArray<GatherSeries>): void => {
    if (header === null) header = header_build();
    for (const entry of entries) header.series_add(entry);
    const away: boolean = document.body.dataset['header'] === 'away';
    if (!bandDismissed || !away) {
      document.body.dataset['header'] = 'gather';
      bandDismissed = false;
    }
    annunciate();
    keep();
  };

  const open = (entries: ReadonlyArray<GatherSeries>, host: string = 'pacs'): string | null => {
    const { layout } = context;
    const shown: Set<string> = new Set(layout.panes_shown());
    let id: string | null = panels.ids('gather').find((paneId: string): boolean => shown.has(paneId)) ?? null;
    if (id === null) {
      const from: string = shown.has(host) ? host : (hooks.errandHost_find() ?? host);
      const spawned: PaneInstance = hooks.instance_spawn('gather', 'pacs');
      const place: ReplayPlace | null = hooks.replayPlace_get();
      if (!layout.leaf_split(from, place?.dir ?? 'row', spawned.id, place?.before ?? false)) {
        paneInstance_dispose(spawned.id);
        layout.mount_remove(spawned.id);
        return null;
      }
      hooks.birth_record(spawned.id, from, place?.dir ?? 'row', place?.before ?? false);
      id = spawned.id;
    }
    const panel: GatherPanel | undefined = panels.get('gather', id);
    if (panel === undefined) return null;
    for (const entry of entries) panel.series_add(entry);
    return id;
  };

  return {
    cohort,
    instance_build,
    has: (seriesUID: string): boolean => header?.has(seriesUID) === true,
    gather,
    open,
    stage,
    annunciate,
    restore,
  };
}
