/**
 * @file Tests for the touch command core.
 * Salsa and path resolution are mocked at their seams; local file reads use a
 * real temporary file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let mockSalsaTouch: jest.Mock;
jest.mock('@fnndsc/salsa', () => ({
  files_touch: (...args: unknown[]): unknown => mockSalsaTouch(...args),
}));
let mockResolve: jest.Mock;
jest.mock('../src/utils/cli', () => ({
  path_resolveChrisFs: (...args: unknown[]): unknown => mockResolve(...args),
}));

import { errorStack } from '@fnndsc/cumin';
import { files_touch } from '../src/commands/fs/touch';

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSalsaTouch = jest.fn(async (): Promise<boolean> => true);
  mockResolve = jest.fn(async (filePath: string): Promise<string> => `/home/chris${filePath}`);
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('files_touch', () => {
  it('creates an empty file at the resolved path', async (): Promise<void> => {
    expect(await files_touch('/notes.txt')).toBe(true);
    expect(mockSalsaTouch).toHaveBeenCalledWith('/home/chris/notes.txt');
  });

  it('passes inline contents through', async (): Promise<void> => {
    await files_touch('/notes.txt', { withContents: 'hello' });
    expect(mockSalsaTouch).toHaveBeenCalledWith('/home/chris/notes.txt', 'hello');
  });

  it('reads contents from a local file', async (): Promise<void> => {
    const tmp: string = path.join(os.tmpdir(), `chili-touch-${process.pid}.txt`);
    fs.writeFileSync(tmp, 'from disk', 'utf-8');
    try {
      await files_touch('/notes.txt', { withContentsFromFile: tmp });
      expect(mockSalsaTouch).toHaveBeenCalledWith('/home/chris/notes.txt', 'from disk');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('fails when the local file is missing', async (): Promise<void> => {
    expect(await files_touch('/notes.txt', { withContentsFromFile: '/no/such/file' })).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Local file not found'));
    expect(mockSalsaTouch).not.toHaveBeenCalled();
  });

  it('fails when the local file read throws', async (): Promise<void> => {
    const existsSpy: jest.SpiedFunction<typeof fs.existsSync> = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy: jest.SpiedFunction<typeof fs.readFileSync> = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(await files_touch('/notes.txt', { withContentsFromFile: '/locked' })).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('EACCES'));
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });
});
