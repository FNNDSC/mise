import { describe, expect, it } from '@jest/globals';
import type { WireEnvelope } from '@fnndsc/menu';
import { listing_isAnswered, refusalWords_of } from '../../src/features/files/answer.js';

describe('a press on the Files panel', () => {
  it('is answered by a listing marked an error by a side lookup', () => {
    const envelope = { status: 'error', rendered: '', model: { kind: 'fs.listing', data: [{ path: '/a', items: [] }] } } as unknown as WireEnvelope;
    expect(listing_isAnswered(envelope)).toBe(true);
  });

  it('is refused by a listing that failed outright', () => {
    const envelope = { status: 'error', rendered: '', model: { kind: 'fs.listing', data: [] } } as unknown as WireEnvelope;
    expect(listing_isAnswered(envelope)).toBe(false);
  });

  it('reads every line the kernel said, colours stripped', () => {
    const envelope = {
      status: 'error',
      rendered: '',
      renderedErr: "\x1b[31mCannot list /x: No such file or directory\x1b[0m\n\x1b[33mls: links in '/home/owner' could not be read; the path was walked as written\x1b[0m\n",
    } as unknown as WireEnvelope;
    expect(refusalWords_of(envelope)).toBe("Cannot list /x: No such file or directory · ls: links in '/home/owner' could not be read; the path was walked as written");
  });

  it('falls back to the last drained error, then a plain word', () => {
    const drained = { status: 'error', rendered: '', errors: [{ type: 'error', message: '[ls] | refused here' }] } as unknown as WireEnvelope;
    expect(refusalWords_of(drained)).toBe('refused here');
    expect(refusalWords_of({ status: 'error', rendered: '' } as unknown as WireEnvelope)).toBe('refused');
  });
});
