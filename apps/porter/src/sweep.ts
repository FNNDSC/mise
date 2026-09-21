/**
 * @file The idle sweep: sessions nobody is on, ended after a day.
 *
 * A session with no wire open and nothing through the door for the idle
 * span is ended — the process, never the identity's state directory, so
 * the next login boots warm. The registry forgets it; a cookie that still
 * names it sends its browser back through the door, where the password is
 * checked again and the session started again.
 *
 * @module
 */
import type { SessionHost } from './host/sessionHost.js';
import type { SessionRegistry, SessionEntry } from './registry.js';

/**
 * Ends every idle session once.
 *
 * @param registry - Who is on what, and since when.
 * @param host - Where sessions run.
 * @param idleMs - The span after which a session with nobody on it is ended.
 * @param log - Told each session ended.
 * @returns The keys ended.
 */
export async function idleSweep_run(
  registry: SessionRegistry,
  host: Pick<SessionHost, 'evict'>,
  idleMs: number,
  log: (line: string) => void = (): void => undefined,
): Promise<string[]> {
  const ended: string[] = [];
  for (const entry of registry.idle_list(idleMs)) {
    const idleFor: number = Math.round((Date.now() - entry.activeAt) / 60_000);
    await host.evict(entry.identity);
    registry.forget(entry.key);
    ended.push(entry.key);
    log(`ended ${entry.user}'s session after ${idleFor} min idle; the state directory stays`);
  }
  return ended;
}

/**
 * The idle entries, for a listing or a test, without ending anything.
 *
 * @param registry - Who is on what.
 * @param idleMs - The span.
 * @returns The entries idle longer than the span.
 */
export function idle_list(registry: SessionRegistry, idleMs: number): SessionEntry[] {
  return registry.idle_list(idleMs);
}
