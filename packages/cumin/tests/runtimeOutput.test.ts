/** Tests for the host-installed lower-layer runtime output port. */

import {
  runtimeOutput_data,
  runtimeOutput_err,
  runtimeOutput_set,
  type RuntimeOutput,
} from '../src/output/runtimeOutput';

describe('runtime output', () => {
  it('delivers ordinary and diagnostic messages to the installed host port', () => {
    const data: string[] = [];
    const errors: string[] = [];
    const output: RuntimeOutput = {
      data_write: (chunk: string | Buffer): void => { data.push(chunk.toString()); },
      err_write: (chunk: string | Buffer): void => { errors.push(chunk.toString()); },
    };
    const previous: RuntimeOutput = runtimeOutput_set(output);
    try {
      runtimeOutput_data('notice');
      runtimeOutput_err('problem');
      expect(data).toEqual(['notice']);
      expect(errors).toEqual(['problem']);
    } finally {
      runtimeOutput_set(previous);
    }
  });
});
