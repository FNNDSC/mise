/**
 * @file The ambient bus: events the engine originates on its own.
 *
 * A command answers with envelopes; a sampler that keeps a watched feed
 * live has no command to answer. Its refreshed models, and the watch state
 * changes around them, travel here. A host (the daemon) subscribes once and
 * relays each event to every surface; a host that never subscribes simply
 * never hears them — the engine does not care.
 *
 * @module
 */
import type { AmbientEvent } from '@fnndsc/menu';

const listeners: Set<(event: AmbientEvent) => void> = new Set();

/**
 * Subscribes to ambient events.
 *
 * @param listener - Receives each event as it is published.
 * @returns Function that unsubscribes.
 */
export function ambient_listen(listener: (event: AmbientEvent) => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

/**
 * Publishes one ambient event to every subscriber. A subscriber that throws
 * does not stop the others.
 *
 * @param event - The event to publish.
 */
export function ambient_publish(event: AmbientEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // One host's failure is not another's.
    }
  }
}
