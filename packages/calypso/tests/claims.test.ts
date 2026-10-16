/**
 * @file Surface claims: a line belongs to a surface when its subject is
 * claimed whole, or when a shared subject's second word is a claimed verb;
 * a pipe, list or redirect stays the session's; completion offers subjects
 * and claimed verbs.
 *
 * @module
 */
import { claim_match, claimCandidates_of, type SurfaceClaim } from '../src/daemon/claims';

const CLAIMS: SurfaceClaim[] = [
  { subject: 'dag' },
  { subject: 'desktop' },
  { subject: 'file', verbs: ['open', 'home', 'sort'] },
  { subject: 'help', verbs: ['pane', 'keys'] },
];

describe('claim_match', () => {
  it('claims a whole subject, whatever follows', () => {
    expect(claim_match(CLAIMS, 'dag %1 census on')).toBe('dag');
    expect(claim_match(CLAIMS, '  Desktop show')).toBe('desktop');
  });

  it('claims a shared subject only for its claimed verbs, read as the second word', () => {
    expect(claim_match(CLAIMS, 'file open /home/x')).toBe('file');
    expect(claim_match(CLAIMS, 'file input.txt')).toBeNull();
    expect(claim_match(CLAIMS, 'help keys')).toBe('help');
    expect(claim_match(CLAIMS, 'help ls')).toBeNull();
    expect(claim_match(CLAIMS, 'help')).toBeNull();
  });

  it('leaves the session its own lines, and every compound line', () => {
    expect(claim_match(CLAIMS, 'ls -l')).toBeNull();
    expect(claim_match(CLAIMS, 'dag census on | cat')).toBeNull();
    expect(claim_match(CLAIMS, 'desktop show; ls')).toBeNull();
    expect(claim_match(CLAIMS, 'desktop show > out.txt')).toBeNull();
    expect(claim_match(CLAIMS, '   ')).toBeNull();
  });
});

describe('claimCandidates_of', () => {
  it('offers subjects for a first word, and a shared subject\'s claimed verbs for a second', () => {
    expect(claimCandidates_of(CLAIMS, 'de')).toEqual(['desktop']);
    expect(claimCandidates_of(CLAIMS, 'd')).toEqual(['dag', 'desktop']);
    expect(claimCandidates_of(CLAIMS, 'file o')).toEqual(['open']);
    expect(claimCandidates_of(CLAIMS, 'help ')).toEqual(['keys', 'pane']);
  });

  it('offers nothing past the second word, for a whole subject\'s verbs, or in a compound line', () => {
    expect(claimCandidates_of(CLAIMS, 'dag c')).toEqual([]);
    expect(claimCandidates_of(CLAIMS, 'file open x')).toEqual([]);
    expect(claimCandidates_of(CLAIMS, 'ls | de')).toEqual([]);
  });
});
