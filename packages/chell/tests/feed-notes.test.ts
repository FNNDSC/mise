/**
 * @file Unit tests for the pure feed-note editor helpers.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { noteEditBody_format, noteEditBody_parse } from '../src/builtins/res/feed.notes.js';

describe('noteEditBody_format', () => {
  it('renders a Title header followed by the content', () => {
    expect(noteEditBody_format({ title: 'Hi', content: 'body' } as any)).toBe('# Title: Hi\n\nbody');
  });
});

describe('noteEditBody_parse', () => {
  it('round-trips a formatted note', () => {
    const body = noteEditBody_format({ title: 'Hi', content: 'line1\nline2' } as any);
    expect(noteEditBody_parse(body, 'fallback')).toEqual({ title: 'Hi', content: 'line1\nline2' });
  });
  it('extracts an edited title and strips the header + leading blank lines', () => {
    expect(noteEditBody_parse('# Title:   New Title  \n\nfresh content', 'old')).toEqual({
      title: 'New Title',
      content: 'fresh content',
    });
  });
  it('falls back to the original title when the header is removed', () => {
    expect(noteEditBody_parse('just content, no header', 'Original')).toEqual({
      title: 'Original',
      content: 'just content, no header',
    });
  });
});
