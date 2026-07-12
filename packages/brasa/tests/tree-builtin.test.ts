import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Real commandArgs_process / path_resolve run; stub the load-time boundary.
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }), errorStack: { stack_pop: jest.fn(() => undefined) } }));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

const mockGetCWD = jest.fn(async () => '/home/chris');
const mockSetCWD = jest.fn();
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: mockGetCWD, setCWD: mockSetCWD },
}));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: { start: jest.fn(), stop: jest.fn() } }));

// chili scan machinery — the figlet-heavy path modules are stubbed.
const mockScanDo = jest.fn();
const mockArchy = jest.fn(() => 'TREE_OUTPUT');
jest.unstable_mockModule('@fnndsc/chili/path/pathCommand.js', () => ({
  scan_do: mockScanDo,
  archyTree_create: mockArchy,
}));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/upload.js', () => ({ bytes_format: jest.fn(() => '2 KB') }));

const { builtin_tree } = await import('../src/builtins/fs/tree.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  mockGetCWD.mockResolvedValue('/home/chris');
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_tree', () => {
  it('renders an ASCII tree with a size summary', async () => {
    mockScanDo.mockResolvedValue({ fileInfo: [{ chrisPath: '/a' }], totalSize: 2048 });
    const envelope = await builtin_tree([]);
    expect(mockArchy).toHaveBeenCalled();
    expect(envelope.rendered).toContain('TREE_OUTPUT');
    expect(envelope.rendered).toContain('2 KB');
    expect(envelope.rendered).toContain('1 items');
  });

  it('emits one chrisPath per entry in --path mode', async () => {
    mockScanDo.mockResolvedValue({ fileInfo: [{ chrisPath: '/a' }, { chrisPath: '/b' }], totalSize: 0 });
    const envelope = await builtin_tree(['--path']);
    expect(mockArchy).not.toHaveBeenCalled();
    expect(envelope.rendered).toContain('/a');
    expect(envelope.rendered).toContain('/b');
  });

  it('temporarily changes directory for an explicit path and restores it', async () => {
    mockScanDo.mockResolvedValue({ fileInfo: [], totalSize: 0 });
    await builtin_tree(['/data/scans']);
    expect(mockSetCWD).toHaveBeenCalledWith('/data/scans');
    expect(mockSetCWD).toHaveBeenLastCalledWith('/home/chris');
  });

  it('reports a scan failure from the error stack', async () => {
    mockScanDo.mockResolvedValue(null);
    const { errorStack } = await import('@fnndsc/cumin');
    (errorStack.stack_pop as jest.Mock).mockReturnValue({ message: 'scan blew up' });
    const envelope = await builtin_tree([]);
    expect(envelope.renderedErr).toContain('scan blew up');
  });

  it('reports a generic failure when the stack is empty', async () => {
    mockScanDo.mockResolvedValue(null);
    const { errorStack } = await import('@fnndsc/cumin');
    (errorStack.stack_pop as jest.Mock).mockReturnValue(undefined);
    const envelope = await builtin_tree([]);
    expect(envelope.renderedErr).toContain('Failed to scan');
  });
});
