import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockRun = jest.fn<(argv: string[]) => Promise<void>>();
jest.unstable_mockModule('@fnndsc/chili/run.js', () => ({ run: mockRun }));

const { chiliCommand_run } = await import('../src/core/chiliDelegate.js');

describe('chiliCommand_run', () => {
  let errSpy: jest.SpiedFunction<typeof console.error>;
  beforeEach(() => {
    jest.clearAllMocks();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('forwards the command and args to chili', async () => {
    mockRun.mockResolvedValue(undefined);
    await chiliCommand_run('feeds', ['-s', 'x']);
    expect(mockRun).toHaveBeenCalledWith(['feeds', '-s', 'x']);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('reports a failure without throwing', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    await expect(chiliCommand_run('feeds', [])).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("chili command 'feeds' failed"));
  });
});
