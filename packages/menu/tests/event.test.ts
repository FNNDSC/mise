/**
 * @file Schema tests for the typed event.
 *
 * An event is what a running command shows its surface that is neither text
 * nor progress: a kind names it, the kind shapes the data. The properties
 * worth pinning: it is a server message in its own right, correlated to its
 * command; the data is whatever the kind says; a kind the surface does not
 * know is still a well-formed message, so the surface can drop it rather
 * than choke on it.
 */
import { describe, it, expect } from '@jest/globals';
import { eventMessageSchema, serverMessageSchema, type EventMessage } from '../src/messages.js';

describe('the event message', () => {
  it('carries a kind and data correlated to a command', () => {
    const parsed: EventMessage = eventMessageSchema.parse({ type: 'event', id: 'c7', kind: 'games.trek.state', data: { Ship: { energy: 2350 } } });
    expect(parsed.kind).toBe('games.trek.state');
    expect((parsed.data as { Ship: { energy: number } }).Ship.energy).toBe(2350);
  });

  it('is one of the messages a daemon may send', () => {
    const parsed = serverMessageSchema.parse({ type: 'event', id: 'c7', kind: 'anything.at.all', data: null });
    expect(parsed.type).toBe('event');
  });

  it('needs its kind and its command', () => {
    expect(eventMessageSchema.safeParse({ type: 'event', id: 'c7', data: 1 }).success).toBe(false);
    expect(eventMessageSchema.safeParse({ type: 'event', kind: 'k', data: 1 }).success).toBe(false);
  });
});
