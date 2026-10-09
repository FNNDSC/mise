import { commandEnvelopeSchema, envelope_ok, envelope_error, envelope_isOk } from '../src/envelope';

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

describe('the envelope helpers', () => {
  it('make an ok envelope, with its model only when there is one', () => {
    expect(envelope_ok('hi\n')).toEqual({ status: 'ok', rendered: 'hi\n' });
    expect(envelope_ok('', { kind: 'fs.listing', data: [] })).toEqual({ status: 'ok', rendered: '', model: { kind: 'fs.listing', data: [] } });
  });

  it('make an error envelope, with errors and error text only when given', () => {
    expect(envelope_error('')).toEqual({ status: 'error', rendered: '' });
    expect(envelope_error('', [{ type: 'error', message: 'no' }], 'no\n')).toEqual({
      status: 'error', rendered: '', errors: [{ type: 'error', message: 'no' }], renderedErr: 'no\n',
    });
  });

  it('say whether an envelope succeeded', () => {
    expect(envelope_isOk(envelope_ok(''))).toBe(true);
    expect(envelope_isOk(envelope_error(''))).toBe(false);
  });
});
