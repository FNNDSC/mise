/**
 * @jest-environment jsdom
 *
 * @file The ChRIS composition's routes: a cohort the kernel sends on the
 * session bus is adopted like one a line answers with (#1252).
 */
import { describe, it, expect, jest } from '@jest/globals';
import type { WireEnvelope } from '@fnndsc/menu';
import { ModelRouter } from '../../src/frame/modelRouter.js';
import { chrisRoutes_install, type ChrisRouteContext } from '../../src/compositions/chris/routes.js';

const envelope = (kind: string, data: unknown = null): WireEnvelope => ({ status: 'ok', rendered: '', model: { kind, data } }) as WireEnvelope;

/** A context whose cohort records what it was shown; nothing else is reached. */
function context_make(adopted: WireEnvelope[]): ChrisRouteContext {
  const unreached = (): never => { throw new Error('not reached by a cohort'); };
  return {
    dag_target: unreached,
    dags: () => [],
    universes: () => [],
    pacs: unreached,
    pacs_present: unreached,
    image_open: unreached,
    pane_replace: unreached,
    dag_get: () => undefined,
    image_get: () => undefined,
    tags_get: () => undefined,
    cohort_adopt: (sent: WireEnvelope): void => { adopted.push(sent); },
  } as unknown as ChrisRouteContext;
}

describe('the ChRIS routes', () => {
  it('adopt a cohort that arrives on the session bus, as gather process and pull --new-feed send it', () => {
    const router: ModelRouter = new ModelRouter();
    const adopted: WireEnvelope[] = [];
    chrisRoutes_install(router, context_make(adopted));
    const cohort: WireEnvelope = envelope('gather.cohort', { version: 1, name: 'sag', feed: { feedId: 300 }, series: [] });
    expect(router.route('ambient', cohort)).toBe(true);
    expect(adopted).toEqual([cohort]);
  });

  it('leave a cohort a line answers with to the console path, which adopts it already', () => {
    const router: ModelRouter = new ModelRouter();
    const adopted: WireEnvelope[] = [];
    chrisRoutes_install(router, context_make(adopted));
    router.route('console', envelope('gather.cohort'));
    expect(adopted).toEqual([]);
  });
});
