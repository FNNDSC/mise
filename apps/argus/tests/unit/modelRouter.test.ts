/**
 * @file The frame's router: a composition's routes take their models, the
 * frame keeps the rest, and claims name the pane a model becomes.
 */
import { describe, it, expect, jest } from '@jest/globals';
import type { WireEnvelope } from '@fnndsc/menu';
import { ModelRouter } from '../../src/frame/modelRouter.js';

const envelope = (kind: string): WireEnvelope => ({ status: 'ok', rendered: '', model: { kind, data: null } }) as WireEnvelope;

describe('the model router', () => {
  it('hands a model to the routes for its kind, and says whether one took it', () => {
    const router = new ModelRouter();
    const route = jest.fn(() => true);
    router.route_add('console', ['feed.dag', 'feed.list'], route);
    expect(router.route('console', envelope('feed.list'))).toBe(true);
    expect(route).toHaveBeenCalledTimes(1);
    expect(router.route('console', envelope('fs.listing'))).toBe(false);
    expect(router.route('ambient', envelope('feed.dag'))).toBe(false);
    expect(router.route('console', { status: 'ok', rendered: '' } as WireEnvelope)).toBe(false);
  });

  it('lets observers see what the frame kept', () => {
    const router = new ModelRouter();
    const seen: string[] = [];
    router.observer_add('console', (e) => { seen.push(e.model?.kind ?? ''); });
    router.observe('console', envelope('fs.rm'));
    router.observe('ambient', envelope('fs.mv'));
    expect(seen).toEqual(['fs.rm']);
  });

  it('names the pane a model claims, and how the composition makes it', () => {
    const router = new ModelRouter();
    const claim = jest.fn();
    router.claim_add('fs.listing', 'files');
    router.claim_add('feed.dag', 'dag', claim);
    expect(router.claimKind_of('feed.dag')).toBe('dag');
    expect(router.claimKind_of('fs.listing')).toBe('files');
    expect(router.claimKind_of('pacs.query')).toBeUndefined();
    expect(router.claimer_get('dag')).toBe(claim);
    expect(router.claimer_get('files')).toBeUndefined();
  });

  it('tells every watcher a subject\'s state', () => {
    const router = new ModelRouter();
    const heard: string[] = [];
    router.watcher_add((subject, state) => { heard.push(`${subject}:${state}`); });
    router.watcher_add((subject) => { heard.push(subject); });
    router.watched('/proc/jobs/feed_1', 'settled');
    expect(heard).toEqual(['/proc/jobs/feed_1:settled', '/proc/jobs/feed_1']);
  });
});
