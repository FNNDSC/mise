/**
 * `image <path>`: the kernel command that resolves what a path is and emits an
 * `image.view` intent every surface renders in its own way. salsa's reader is
 * mocked; under test is the grammar (help, missing path), how a volume vs a
 * series is told apart, the intent it carries, the honesty of the reflection a
 * TTY prints, and refusal by name.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';

const mockSeries = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
  dicomSeries_summarize: mockSeries,
  dicomFolder_list: jest.fn(),
  dicomHeader_get: jest.fn(),
  dicomTags_summarize: jest.fn(),
  dicomFiles_sample: <T>(files: T[], cap: number): T[] => (files.length <= cap ? files : [files[0], files[files.length - 1]]),
}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown): CommandEnvelope => (model === undefined ? { status: 'ok', rendered } : ({ status: 'ok', rendered, model } as CommandEnvelope)),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string): CommandEnvelope => {
    const envelope: CommandEnvelope = { status: 'error', rendered };
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: jest.fn(async () => '/home/chris/uploads') },
}));

const { builtin_image } = await import('../src/builtins/res/image.js');

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const seriesSummary = {
  path: '/home/chris/uploads/sag-anon',
  seriesInstanceUID: '1.2.3',
  studyInstanceUID: '1.2',
  modality: 'MR',
  seriesDescription: 'T1 SAG',
  seriesNumber: 5,
  instances: 16,
  frames: 1,
  order: 'filename',
  geometry: { rows: 256, columns: 256, pixelSpacing: [0.9, 0.9], sliceThickness: 1.5 },
  transferSyntax: { uid: '1.2.840.10008.1.2.1', name: 'Explicit VR Little Endian' },
  bytes: 2_500_000,
  header: '/home/chris/uploads/sag-anon/0001-1.2.3.1.dcm',
  files: ['/home/chris/uploads/sag-anon/0001-1.2.3.1.dcm'],
  annotations: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
});

describe('builtin_image grammar', () => {
  it('returns help for --help', async () => {
    const envelope: CommandEnvelope = await builtin_image(['--help']);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('USAGE');
  });

  it('returns help when no path is given', async () => {
    const envelope: CommandEnvelope = await builtin_image([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('USAGE');
  });
});

describe('image on a volume file', () => {
  it('names a NIfTI without reading it and carries a volume intent', async () => {
    const envelope: CommandEnvelope = await builtin_image(['/data/brain.nii.gz']);
    expect(mockSeries).not.toHaveBeenCalled();
    expect(envelope.status).toBe('ok');
    expect(envelope.model).toEqual({ kind: 'image.view', data: { path: '/data/brain.nii.gz', target: 'volume' } });
    expect(envelope.rendered).toContain('brain.nii.gz');
  });

  it('carries --force through on the intent', async () => {
    const envelope: CommandEnvelope = await builtin_image(['--force', '/data/brain.mgz']);
    expect(envelope.model).toEqual({ kind: 'image.view', data: { path: '/data/brain.mgz', target: 'volume', force: true } });
  });
});

describe('image on a series', () => {
  it('resolves the folder, carries a series intent, and reflects the same facts dcm series shows', async () => {
    mockSeries.mockResolvedValue(ok(seriesSummary));
    const envelope: CommandEnvelope = await builtin_image(['sag-anon']);
    expect(mockSeries).toHaveBeenCalledWith('/home/chris/uploads/sag-anon', { annotationRoot: '/home/chris/annotations' });
    expect(envelope.status).toBe('ok');
    expect(envelope.model).toEqual({ kind: 'image.view', data: { path: '/home/chris/uploads/sag-anon', target: 'series' } });
    expect(envelope.rendered).toContain('image');
    expect(envelope.rendered).toContain('T1 SAG');
    expect(envelope.rendered).toContain('SERIES');
    expect(envelope.rendered).toContain('MR');
  });

  it('reads the folder a .dcm sits in, not the file', async () => {
    mockSeries.mockResolvedValue(ok(seriesSummary));
    await builtin_image(['/home/chris/uploads/sag-anon/0001-x.dcm']);
    expect(mockSeries).toHaveBeenCalledWith('/home/chris/uploads/sag-anon', expect.anything());
  });

  it('refuses by name when the path is not a readable series or volume', async () => {
    mockSeries.mockResolvedValue(err());
    const envelope: CommandEnvelope = await builtin_image(['nope']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('image: nope: not a readable DICOM series, study, or volume');
    expect(process.exitCode).toBe(1);
  });
});
