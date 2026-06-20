/**
 * @file Unit tests for the pure PACS query payload builder.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { pacsQueryPayload_build } from '../../src/pacs/pacsQueryPayload.js';

describe('pacsQueryPayload_build', () => {
  it('accepts a JSON query and keeps title/description', () => {
    const p = pacsQueryPayload_build('{"PatientID":"123"}', 'My Q', 'desc');
    expect(p).not.toBeNull();
    expect(JSON.parse(p!.query)).toEqual({ PatientID: '123' });
    expect(p!.title).toBe('My Q');
    expect(p!.description).toBe('desc');
  });

  it('parses comma-separated key:value pairs', () => {
    const p = pacsQueryPayload_build('PatientID:123, StudyDate:20240101');
    expect(JSON.parse(p!.query)).toEqual({ PatientID: '123', StudyDate: '20240101' });
  });

  it('preserves colons inside values', () => {
    const p = pacsQueryPayload_build('Time:12:30:00');
    expect(JSON.parse(p!.query)).toEqual({ Time: '12:30:00' });
  });

  it('returns null when no usable fields parse', () => {
    expect(pacsQueryPayload_build('')).toBeNull();
    expect(pacsQueryPayload_build('novalue')).toBeNull();
  });

  it('omits description when not given and defaults the title', () => {
    const p = pacsQueryPayload_build('PatientID:1');
    expect(p!.description).toBeUndefined();
    expect(p!.title).toMatch(/^Query /);
  });
});
