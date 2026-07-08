import { commandEnvelopeSchema } from '../src/protocol/envelope';

describe('commandEnvelopeSchema', () => {
  it('accepts a minimal ok envelope', () => {
    const result = commandEnvelopeSchema.safeParse({ status: 'ok', rendered: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a full envelope with model, errors and trace', () => {
    const result = commandEnvelopeSchema.safeParse({
      status: 'error',
      rendered: 'output',
      renderedErr: 'oops',
      model: { kind: 'fs.listing', data: { rows: [] } },
      errors: [{ type: 'error', message: 'boom' }],
      trace: { input: 'ls feeds', proposed: 'ls /home/x/feeds', validated: true, executed: 'ls /home/x/feeds' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a bad status (structural violation)', () => {
    const result = commandEnvelopeSchema.safeParse({ status: 'maybe', rendered: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const result = commandEnvelopeSchema.safeParse({ status: 'ok' });
    expect(result.success).toBe(false);
  });

  it('tolerates an unknown additive field, stripping it', () => {
    const result = commandEnvelopeSchema.safeParse({ status: 'ok', rendered: 'x', futureField: 42 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('futureField' in result.data).toBe(false);
    }
  });
});
