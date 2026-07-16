/**
 * @file Tests frontend-local command dispatch and the interactive rejection boundary.
 *
 * @module
 */
import { jest, describe, it, expect } from '@jest/globals';
import type { BrasaEngine, CompletionResult } from '@fnndsc/brasa';
import type { CommandEnvelope } from '@fnndsc/cumin';

jest.unstable_mockModule('../src/builtins/sys/prompt.js', () => ({
  builtin_prompt: jest.fn(async (): Promise<void> => undefined),
}));

const { surfaceLine_executeSafely } = await import('../src/core/surfaceDispatch.js');

describe('surfaceLine_executeSafely', () => {
  it('turns a remote engine rejection into an interactive error envelope', async () => {
    const previousExitCode: number | string | undefined = process.exitCode;
    const engine: BrasaEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        throw new Error("ENOENT: no such file or directory, open '~/tmp/pipeline.txt'");
      },
      line_complete: async (prefix: string): Promise<CompletionResult> => ({ candidates: [], prefix }),
    };
    const errorSpy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const envelopes: CommandEnvelope[] = await surfaceLine_executeSafely(engine, 'pipeline > ~/tmp/pipeline.txt');

    expect(envelopes).toEqual([{ status: 'error', rendered: '' }]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    expect(process.exitCode).toBe(1);
    errorSpy.mockRestore();
    process.exitCode = previousExitCode;
  });
});
