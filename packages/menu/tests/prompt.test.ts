/**
 * @file Schema tests for the typed ask.
 *
 * A surface chooses its instrument from what the question wants — a
 * browser for a location, a masked field for a secret, two capsules for a
 * yes/no. So the properties worth pinning are the ones that decide whether
 * a question can be answered at all: that an older prompt still parses and
 * still says what it meant, that an unknown kind stays answerable, and
 * that `hidden` and `wants` are reconciled in ONE place rather than in
 * every surface that reads them.
 */
import { describe, it, expect } from '@jest/globals';
import {
  promptMessageSchema,
  promptKindSchema,
  promptPathSchema,
  promptKind_of,
  PROMPT_KINDS,
  type PromptMessage,
} from '../src/messages.js';

/** A minimal well-formed prompt. */
function prompt_make(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'prompt', promptId: 'p1', message: 'Administrator password: ', hidden: false, ...extra };
}

describe('promptKindSchema', () => {
  it('names the four kinds a question can want', () => {
    expect([...PROMPT_KINDS]).toEqual(['text', 'secret', 'confirm', 'path']);
  });

  // Every surface can answer text, so an unknown kind leaves the question
  // answerable rather than refused — the degrade that costs nothing.
  it('degrades a kind it does not know to text', () => {
    expect(promptKindSchema.parse('hologram')).toBe('text');
  });
});

describe('promptMessageSchema', () => {
  it('carries what it wants, where to start, and what the control should read', () => {
    const parsed = promptMessageSchema.safeParse(prompt_make({
      message: 'where should the audit go?',
      wants: 'path',
      path: { anchor: '/home/chris', wantsDirectory: true, suggest: 'pacs-2026-09-06.csv' },
      commit: 'EXPORT HERE',
    }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const prompt: PromptMessage = parsed.data;
      expect(prompt.path?.anchor).toBe('/home/chris');
      expect(prompt.commit).toBe('EXPORT HERE');
    }
  });

  // A daemon that predates typed asks sends exactly this, and its questions
  // must stay answerable.
  it('accepts a prompt from a daemon that predates the kinds', () => {
    const parsed = promptMessageSchema.safeParse(prompt_make());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.wants).toBeUndefined();
  });

  it('still refuses a prompt missing what every surface needs', () => {
    expect(promptMessageSchema.safeParse({ type: 'prompt', promptId: 'p1', hidden: false }).success).toBe(false);
    expect(promptMessageSchema.safeParse({ type: 'prompt', message: 'x', hidden: false }).success).toBe(false);
  });

  it('refuses a path ask that does not say whether it wants a directory', () => {
    expect(promptMessageSchema.safeParse(prompt_make({
      wants: 'path', path: { anchor: '/home/chris' },
    })).success).toBe(false);
  });

  it('lets a path ask carry only what it knows', () => {
    const parsed = promptPathSchema.safeParse({ wantsDirectory: false });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.anchor).toBeUndefined();
      expect(parsed.data.suggest).toBeUndefined();
    }
  });
});

describe('promptKind_of', () => {
  it('takes the kind the prompt states', () => {
    expect(promptKind_of({ wants: 'path' })).toBe('path');
    expect(promptKind_of({ wants: 'confirm' })).toBe('confirm');
  });

  // `hidden` predates `wants` and was the older wire's only way to say
  // "secret". Reconciled once, here: two readings of one message is how a
  // terminal and a browser end up masking different things.
  it('reads an older prompt: hidden means secret, plain means text', () => {
    expect(promptKind_of({ hidden: true })).toBe('secret');
    expect(promptKind_of({ hidden: false })).toBe('text');
    expect(promptKind_of({})).toBe('text');
  });

  it('lets a stated kind win over the older flag', () => {
    expect(promptKind_of({ hidden: true, wants: 'text' })).toBe('text');
  });
});
