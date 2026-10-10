/**
 * @file Where the ChRIS composition's models go: RUNS (feeds and their DAGs),
 * the universe, PACS, and DICOM images and tags.
 *
 * The frame routes the models it knows (listings, the console's own); these
 * are installed into its router, so the frame never names a ChRIS pane.
 *
 * @module
 */
import {
  DAG_MODEL_KINDS,
  DICOM_MODEL_KINDS,
  IMAGE_MODEL_KINDS,
  dicomSeriesModelSchema,
  dicomTagsModelSchema,
  feedDagModelSchema,
  imageViewModelSchema,
  type WireEnvelope,
  type WatchState,
} from '@fnndsc/menu';
import type { ModelRouter } from '../../frame/modelRouter.js';
import type { DagPanel } from '../../features/dag/panel.js';
import type { UniversePanel } from '../../features/universe/panel.js';
import type { PacsPanel } from '../../features/pacs/panel.js';
import type { ImagePanel } from '../../features/image/panel.js';
import type { TagsPanel } from '../../features/tags/panel.js';

/** What the ChRIS routes reach in the running surface. */
export interface ChrisRouteContext {
  /** The DAG pane a console model goes to: the focused one, else the primary. */
  dag_target(): DagPanel;
  /** Every DAG pane: the primary and its instances. */
  dags(): Iterable<DagPanel>;
  /** Every universe pane. */
  universes(): Iterable<UniversePanel>;
  /** The PACS workspace. */
  pacs(): PacsPanel;
  /** Gives PACS the whole region (its preset), as a claim does. */
  pacs_present(): void;
  /** Opens a DICOM view from where the operator stands; the line it reports goes to the console. */
  image_open(path: string, force: boolean): void;
  /** Turns an empty pane into a new pane of a kind; the new pane's id. */
  pane_replace(emptyId: string, kind: 'dag' | 'image' | 'tags'): string;
  /** A pane by kind and id. */
  dag_get(id: string): DagPanel | undefined;
  image_get(id: string): ImagePanel | undefined;
  tags_get(id: string): TagsPanel | undefined;
}

/**
 * Installs the ChRIS composition's routes into the frame's router.
 *
 * @param router - The frame's router.
 * @param context - What the routes reach.
 */
export function chrisRoutes_install(router: ModelRouter, context: ChrisRouteContext): void {
  // `image <path>` is a kernel command; the intent it emits opens the pane
  // here, so the same command works from a TTY (which prints the reflection)
  // and from this surface (which renders it).
  router.route_add('console', [IMAGE_MODEL_KINDS.view], (envelope: WireEnvelope): boolean => {
    const parsed = imageViewModelSchema.safeParse(envelope.model?.data);
    if (parsed.success) context.image_open(parsed.data.path, parsed.data.force === true);
    return true;
  });
  // A DAG-shaped model goes to the focused DAG instance when one is focused, else the primary.
  router.route_add('console', ['feed.dag', 'feed.list', DAG_MODEL_KINDS.feedIndexing], (envelope: WireEnvelope): boolean => {
    context.dag_target().envelope_observe(envelope);
    return true;
  });
  // PACS sees every console model the routes left to the frame.
  router.observer_add('console', (envelope: WireEnvelope): void => context.pacs().envelope_observe(envelope));
  // The sampler's refreshed DAG: every DAG pane showing that feed repaints in
  // place, and a universe inside the feed too (a-feed-has-one-view).
  router.route_add('ambient', ['feed.dag'], (envelope: WireEnvelope): boolean => {
    const parsed = feedDagModelSchema.safeParse(envelope.model?.data);
    if (!parsed.success) return true;
    for (const dag of context.dags()) dag.model_refresh(parsed.data);
    for (const universe of context.universes()) universe.model_refresh(parsed.data);
    return true;
  });
  router.watcher_add((subject: string, state: WatchState): void => {
    for (const dag of context.dags()) dag.watched_observe(subject, state);
    for (const universe of context.universes()) universe.watched_observe(subject, state);
  });

  // What an empty pane's answer claims it as.
  const dag_claim = (emptyId: string, envelopes: WireEnvelope[]): void => {
    const dag: DagPanel | undefined = context.dag_get(context.pane_replace(emptyId, 'dag'));
    for (const envelope of envelopes) dag?.envelope_observe(envelope);
  };
  router.claim_add('feed.dag', 'dag', dag_claim);
  router.claim_add('feed.list', 'dag', dag_claim);
  // The PACS workspace claims the whole region by design.
  router.claim_add('pacs.query', 'pacs', (_emptyId: string, envelopes: WireEnvelope[]): void => {
    context.pacs_present();
    for (const envelope of envelopes) context.pacs().envelope_observe(envelope);
  });
  router.claim_add(DICOM_MODEL_KINDS.series, 'image', (emptyId: string, envelopes: WireEnvelope[]): void => {
    const image: ImagePanel | undefined = context.image_get(context.pane_replace(emptyId, 'image'));
    for (const envelope of envelopes) {
      if (envelope.model?.kind !== DICOM_MODEL_KINDS.series) continue;
      const parsed = dicomSeriesModelSchema.safeParse(envelope.model.data);
      if (parsed.success) void image?.series_show(parsed.data);
    }
  });
  router.claim_add(DICOM_MODEL_KINDS.tags, 'tags', (emptyId: string, envelopes: WireEnvelope[]): void => {
    const tags: TagsPanel | undefined = context.tags_get(context.pane_replace(emptyId, 'tags'));
    for (const envelope of envelopes) {
      if (envelope.model?.kind !== DICOM_MODEL_KINDS.tags) continue;
      const parsed = dicomTagsModelSchema.safeParse(envelope.model.data);
      if (parsed.success) tags?.model_show(parsed.data);
    }
  });
}
