import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockRunCapture = jest.fn<(argv: string[]) => Promise<{ out: string; err: string }>>();
const mockCommandNames = jest.fn<() => Promise<Set<string>>>();
jest.unstable_mockModule('@fnndsc/chili/run.js', () => ({ run: jest.fn(), run_capture: mockRunCapture, commandNames_get: mockCommandNames }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
}));

const { chiliCommand_run, chiliCommand_exists } = await import('../src/core/chiliDelegate.js');

describe('chiliCommand_run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
  });

  it('forwards the command and args to chili and returns the captured output', async () => {
    mockRunCapture.mockResolvedValue({ out: 'FEED_TABLE\n', err: '' });
    const envelope = await chiliCommand_run('feeds', ['-s', 'x']);
    expect(mockRunCapture).toHaveBeenCalledWith(['feeds', '-s', 'x']);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('FEED_TABLE\n');
    expect(envelope.renderedErr).toBeUndefined();
  });

  it('carries captured error output in renderedErr', async () => {
    mockRunCapture.mockResolvedValue({ out: '', err: 'bad thing\n' });
    const envelope = await chiliCommand_run('feeds', []);
    expect(envelope.renderedErr).toBe('bad thing\n');
  });

  it('reports a thrown failure without throwing', async () => {
    mockRunCapture.mockRejectedValue(new Error('boom'));
    const envelope = await chiliCommand_run('feeds', []);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain("chili command 'feeds' failed");
    expect(process.exitCode).toBe(1);
  });
});

describe('chiliCommand_exists', () => {
  it('is true for a command chili exposes and false otherwise', async () => {
    mockCommandNames.mockResolvedValue(new Set(['feeds', 'plugins', 'files']));
    expect(await chiliCommand_exists('feeds')).toBe(true);
    expect(await chiliCommand_exists('files')).toBe(true);
    expect(await chiliCommand_exists('fortune')).toBe(false);
  });
});
