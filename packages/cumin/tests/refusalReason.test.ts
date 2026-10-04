/**
 * @file A refusal from CUBE says why, in CUBE's own words, whatever the body's shape.
 */
import { refusalReason_of } from '../src/chrisapi/adapter';

describe('refusalReason_of', () => {
  it('reads Django REST field errors, every field', () => {
    expect(refusalReason_of('{"username":["Ensure this field has at least 4 characters."],"password":["Too short."]}'))
      .toBe('username: Ensure this field has at least 4 characters.; password: Too short.');
  });

  it('reads a detail and a Collection+JSON error', () => {
    expect(refusalReason_of('{"detail":"You do not have permission to perform this action."}')).toBe('You do not have permission to perform this action.');
    expect(refusalReason_of('{"collection":{"error":{"message":"{\\"username\\":[\\"taken\\"]}"}}}')).toBe('username: taken');
  });

  it('reads an HTML error page as its text, without styles', () => {
    expect(refusalReason_of('<!DOCTYPE html><html><head><title>403 Forbidden</title><style>body { padding: 10px; }</style></head><body><h1>Forbidden <span>(403)</span></h1><p>CSRF verification failed. Request aborted.</p></body></html>'))
      .toBe('403 Forbidden Forbidden (403) CSRF verification failed. Request aborted.');
  });

  it('falls back to the body itself, or says none was given', () => {
    expect(refusalReason_of('502 Bad Gateway')).toBe('502 Bad Gateway');
    expect(refusalReason_of('')).toBe('no reason given');
  });
});
