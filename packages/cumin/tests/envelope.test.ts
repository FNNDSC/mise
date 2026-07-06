/**
 * @file Unit tests for the command result envelope.
 */

import {
  CommandEnvelope,
  EnvelopeModel,
  ResolutionTrace,
  envelope_ok,
  envelope_error,
  envelope_isOk,
} from '../src/utils/envelope';
import { StackMessage } from '../src/error/errorStack';

describe('CommandEnvelope', () => {
  describe('envelope_ok()', () => {
    it('should create an ok envelope with rendered text', () => {
      const envelope: CommandEnvelope = envelope_ok('hello\n');
      expect(envelope.status).toBe('ok');
      expect(envelope.rendered).toBe('hello\n');
      expect(envelope.model).toBeUndefined();
      expect(envelope.errors).toBeUndefined();
    });

    it('should attach a typed model when provided', () => {
      const model: EnvelopeModel = {
        kind: 'fs.listing',
        data: [{ name: 'brain.mgz', size: 12345 }],
      };
      const envelope: CommandEnvelope = envelope_ok('brain.mgz\n', model);
      expect(envelope.model).toBeDefined();
      expect(envelope.model?.kind).toBe('fs.listing');
      expect(Array.isArray(envelope.model?.data)).toBe(true);
    });

    it('should preserve ANSI sequences in rendered text', () => {
      const colored: string = '\x1b[32mok\x1b[0m\n';
      const envelope: CommandEnvelope = envelope_ok(colored);
      expect(envelope.rendered).toBe(colored);
    });

    it('should allow an empty rendered string', () => {
      const envelope: CommandEnvelope = envelope_ok('');
      expect(envelope.status).toBe('ok');
      expect(envelope.rendered).toBe('');
    });
  });

  describe('envelope_error()', () => {
    it('should create an error envelope without error detail', () => {
      const envelope: CommandEnvelope = envelope_error('');
      expect(envelope.status).toBe('error');
      expect(envelope.errors).toBeUndefined();
    });

    it('should carry drained error messages', () => {
      const drained: StackMessage[] = [
        { type: 'error', message: 'Failed to resolve path' },
        { type: 'warning', message: 'Cache was cold' },
      ];
      const envelope: CommandEnvelope = envelope_error('', drained);
      expect(envelope.errors).toHaveLength(2);
      expect(envelope.errors?.[0].type).toBe('error');
      expect(envelope.errors?.[1].message).toBe('Cache was cold');
    });

    it('should preserve partial output produced before failure', () => {
      const envelope: CommandEnvelope = envelope_error('partial line\n');
      expect(envelope.rendered).toBe('partial line\n');
    });
  });

  describe('envelope_isOk()', () => {
    it('should return true for ok envelopes', () => {
      expect(envelope_isOk(envelope_ok('x'))).toBe(true);
    });

    it('should return false for error envelopes', () => {
      expect(envelope_isOk(envelope_error(''))).toBe(false);
    });
  });

  describe('ResolutionTrace', () => {
    it('should record an executed intent resolution', () => {
      const trace: ResolutionTrace = {
        input: 'show me my running jobs',
        proposed: 'ls /proc/feeds',
        validated: true,
        executed: 'ls /proc/feeds',
      };
      const envelope: CommandEnvelope = { ...envelope_ok('feed_1\n'), trace };
      expect(envelope.trace?.validated).toBe(true);
      expect(envelope.trace?.executed).toBe('ls /proc/feeds');
    });

    it('should record a rejected proposal without an executed command', () => {
      const trace: ResolutionTrace = {
        input: 'delete everything',
        proposed: 'rm -rf /nonexistent',
        validated: false,
      };
      const envelope: CommandEnvelope = { ...envelope_error(''), trace };
      expect(envelope.trace?.validated).toBe(false);
      expect(envelope.trace?.executed).toBeUndefined();
    });
  });
});
