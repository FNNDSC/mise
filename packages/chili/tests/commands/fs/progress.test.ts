import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { bytes_format, eta_format, files_upload, files_uploadWithProgress, rate_format, type UploadProgressEvent } from '../../../src/commands/fs/upload';
import { files_downloadWithProgress, type DownloadProgressEvent } from '../../../src/commands/fs/download';
import * as cliUtils from '../../../src/utils/cli';
import { chrisIO } from '@fnndsc/cumin';
import { fileContent_getBinaryStream, files_listRecursive, files_uploadPath } from '@fnndsc/salsa';
import { prompt_confirmOrThrow } from '../../../src/utils/input_format';

jest.mock('../../../src/utils/cli');
jest.mock('../../../src/utils/input_format', () => ({
  prompt_confirmOrThrow: jest.fn(),
}));
jest.mock('@fnndsc/cumin', () => ({
  chrisIO: {
    client_get: jest.fn(),
    file_upload: jest.fn(),
  },
}));
jest.mock('@fnndsc/salsa', () => ({
  fileContent_getBinaryStream: jest.fn(),
  files_listRecursive: jest.fn(),
  files_uploadPath: jest.fn(),
}));

describe('fs structured progress producers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chili-progress-'));
    (cliUtils.path_resolveChrisFs as jest.Mock).mockImplementation(async (p: string | undefined) => p ?? '/');
    (chrisIO.client_get as jest.Mock).mockResolvedValue(null);
    (chrisIO.file_upload as jest.Mock).mockResolvedValue(true);
    (prompt_confirmOrThrow as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits upload scan, transfer, and completion events', async () => {
    const localFile = path.join(tmpDir, 'image.dcm');
    await fs.promises.writeFile(localFile, 'abc');
    const events: UploadProgressEvent[] = [];

    const summary = await files_uploadWithProgress(localFile, '/remote', {
      onProgress: event => { events.push(event); },
    });

    expect(summary.transferredCount).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({ operation: 'upload', phase: 'scanning', status: 'running' }),
      expect.objectContaining({ operation: 'upload', phase: 'transferring', current: 0, total: 1, percent: 0, unit: 'files' }),
      expect.objectContaining({ operation: 'upload', phase: 'transferring', current: 1, total: 1, percent: 100, unit: 'files' }),
      expect.objectContaining({ operation: 'upload', phase: 'complete', current: 1, total: 1, percent: 100, unit: 'files', status: 'done' }),
    ]);
  });

  it('emits failed upload completion when one file does not upload', async () => {
    const localFile = path.join(tmpDir, 'bad.dcm');
    await fs.promises.writeFile(localFile, 'abc');
    const events: UploadProgressEvent[] = [];
    (chrisIO.file_upload as jest.Mock).mockResolvedValue(false);

    const summary = await files_uploadWithProgress(localFile, '/remote', {
      onProgress: event => { events.push(event); },
    });

    expect(summary.failedCount).toBe(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'upload', phase: 'failed', current: 0, total: 1, status: 'error' }),
    ]));
  });

  it('scans directory uploads and confirms an existing target', async () => {
    const localDir = path.join(tmpDir, 'study');
    await fs.promises.mkdir(path.join(localDir, 'series'), { recursive: true });
    await fs.promises.writeFile(path.join(localDir, 'a.dcm'), 'a');
    await fs.promises.writeFile(path.join(localDir, 'series', 'b.dcm'), 'bb');
    const events: UploadProgressEvent[] = [];
    (chrisIO.client_get as jest.Mock).mockResolvedValue({
      getFileBrowserFolders: jest.fn().mockResolvedValue({
        getItems: jest.fn().mockResolvedValue([{ path: '/remote/study' }]),
      }),
    });

    const summary = await files_uploadWithProgress(localDir, '/remote', {
      onProgress: event => { events.push(event); },
    });

    expect(prompt_confirmOrThrow).toHaveBeenCalledWith(expect.stringContaining("Target '/remote/study' already exists"));
    expect(summary.totalFiles).toBe(2);
    expect(summary.transferSize).toBe(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'upload', phase: 'transferring', current: 2, total: 2, percent: 100 }),
      expect.objectContaining({ operation: 'upload', phase: 'complete', current: 2, total: 2, status: 'done' }),
    ]));
  });

  it('formats transfer helper values and delegates plain upload', async () => {
    (files_uploadPath as jest.Mock).mockResolvedValue(true);

    await expect(files_upload('local.txt', '/remote')).resolves.toBe(true);

    expect(files_uploadPath).toHaveBeenCalledWith('local.txt', '/remote');
    expect(bytes_format(0)).toBe('0 B');
    expect(bytes_format(2048)).toBe('2 KB');
    expect(eta_format(null)).toBe('--');
    expect(eta_format(59.4)).toBe('59s');
    expect(eta_format(3661)).toBe('1h 1m 1s');
    expect(rate_format(0)).toBe('--');
    expect(rate_format(2048)).toBe('2 KB/s');
  });

  it('emits byte progress for a single-file download', async () => {
    const destination = path.join(tmpDir, 'out.dcm');
    const events: DownloadProgressEvent[] = [];
    (files_listRecursive as jest.Mock).mockRejectedValue(new Error('not a directory'));
    (fileContent_getBinaryStream as jest.Mock).mockResolvedValue({
      ok: true,
      value: {
        stream: Readable.from([Buffer.from('ab'), Buffer.from('cd')]),
        size: 4,
      },
    });

    const summary = await files_downloadWithProgress('/remote/image.dcm', destination, {
      onProgress: event => { events.push(event); },
    });

    expect(summary.transferredCount).toBe(1);
    expect(await fs.promises.readFile(destination, 'utf8')).toBe('abcd');
    expect(events).toEqual([
      expect.objectContaining({ operation: 'download', phase: 'transferring', current: 2, total: 4, percent: 50, unit: 'bytes' }),
      expect.objectContaining({ operation: 'download', phase: 'transferring', current: 4, total: 4, percent: 100, unit: 'bytes' }),
      expect.objectContaining({ operation: 'download', phase: 'complete', current: 4, total: 4, percent: 100, unit: 'bytes', status: 'done' }),
    ]);
  });

  it('emits failed download progress when a single file cannot be opened', async () => {
    const destination = path.join(tmpDir, 'missing.dcm');
    const events: DownloadProgressEvent[] = [];
    (files_listRecursive as jest.Mock).mockRejectedValue(new Error('not a directory'));
    (fileContent_getBinaryStream as jest.Mock).mockResolvedValue({ ok: false });

    await expect(files_downloadWithProgress('/remote/missing.dcm', destination, {
      onProgress: event => { events.push(event); },
    })).rejects.toThrow('Failed to download file');

    expect(events).toEqual([
      expect.objectContaining({ operation: 'download', phase: 'failed', status: 'error' }),
    ]);
  });

  it('throws before download when the local file exists without force', async () => {
    const destination = path.join(tmpDir, 'exists.dcm');
    await fs.promises.writeFile(destination, 'old');

    await expect(files_downloadWithProgress('/remote/image.dcm', destination)).rejects.toThrow('Use -f flag');
  });

  it('emits directory download scan, transfer, and failed completion events', async () => {
    const destination = path.join(tmpDir, 'downloads');
    const events: DownloadProgressEvent[] = [];
    (files_listRecursive as jest.Mock).mockResolvedValue([
      { type: 'dir', path: '/remote/study' },
      { type: 'file', path: '/remote/study/a.dcm', size: 1 },
      { type: 'file', path: '/remote/study/nested/b.dcm', size: 2 },
      { type: 'file', path: '/remote/study/c.dcm', size: 3 },
    ]);
    (fileContent_getBinaryStream as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        value: { stream: Readable.from([Buffer.from('a')]), size: 1 },
      })
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('boom'));

    const summary = await files_downloadWithProgress('/remote/study', destination, {
      onProgress: event => { events.push(event); },
    });

    expect(summary.totalFiles).toBe(3);
    expect(summary.transferredCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(await fs.promises.readFile(path.join(destination, 'study', 'a.dcm'), 'utf8')).toBe('a');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'download', phase: 'scanning', status: 'running' }),
      expect.objectContaining({ operation: 'download', phase: 'transferring', current: 0, total: 3, unit: 'files' }),
      expect.objectContaining({ operation: 'download', phase: 'transferring', current: 3, total: 3, percent: 100 }),
      expect.objectContaining({ operation: 'download', phase: 'failed', current: 1, total: 3, status: 'error' }),
    ]));
  });
});
