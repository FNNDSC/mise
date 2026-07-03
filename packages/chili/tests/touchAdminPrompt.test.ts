/**
 * @file Tests for the touch command core and admin credential prompting.
 * salsa and path resolution mocked at their seams; local file reads use a
 * real temp directory. The raw-readline fallbacks stay untested (raw TTY).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let mockSalsaTouch: jest.Mock;
jest.mock('@fnndsc/salsa', () => ({
  files_touch: (...a: unknown[]): unknown => mockSalsaTouch(...a),
}));
let mockResolve: jest.Mock;
jest.mock('../src/utils/cli', () => ({
  path_resolveChrisFs: (...a: unknown[]): unknown => mockResolve(...a),
}));

import { files_touch } from '../src/commands/fs/touch';
import {
  adminPrompt_register,
  adminCredentials_prompt,
  adminCredentials_validate,
} from '../src/utils/admin_prompt';
import { errorStack } from '@fnndsc/cumin';

let pushSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSalsaTouch = jest.fn(async () => true);
  mockResolve = jest.fn(async (p: string) => `/home/chris${p}`);
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
  logSpy.mockRestore();
});

describe('files_touch', () => {
  it('creates an empty file at the resolved path', async () => {
    expect(await files_touch('/notes.txt')).toBe(true);
    expect(mockSalsaTouch).toHaveBeenCalledWith('/home/chris/notes.txt');
  });

  it('passes inline contents through', async () => {
    await files_touch('/notes.txt', { withContents: 'hello' });
    expect(mockSalsaTouch).toHaveBeenCalledWith('/home/chris/notes.txt', 'hello');
  });

  it('reads contents from a local file', async () => {
    const tmp: string = path.join(os.tmpdir(), `chili-touch-${process.pid}.txt`);
    fs.writeFileSync(tmp, 'from disk', 'utf-8');
    try {
      await files_touch('/notes.txt', { withContentsFromFile: tmp });
      expect(mockSalsaTouch).toHaveBeenCalledWith('/home/chris/notes.txt', 'from disk');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('fails when the local file is missing', async () => {
    expect(await files_touch('/notes.txt', { withContentsFromFile: '/no/such/file' })).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Local file not found'));
    expect(mockSalsaTouch).not.toHaveBeenCalled();
  });

  it('fails when the local file read throws', async () => {
    const existsSpy: jest.SpyInstance = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy: jest.SpyInstance = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(await files_touch('/notes.txt', { withContentsFromFile: '/locked' })).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('EACCES'));
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });
});

describe('adminCredentials_prompt', () => {
  it('collects credentials through the registered REPL functions', async () => {
    adminPrompt_register(async () => 'admin', async () => 's3cret');
    expect(await adminCredentials_prompt()).toEqual({ username: 'admin', password: 's3cret' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Admin credentials required'));
  });

  it('shows the retry banner on later attempts', async () => {
    adminPrompt_register(async () => 'admin', async () => 'pw');
    await adminCredentials_prompt(2, 3);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Attempt 2 of 3'));
  });

  it('cancels on an empty username or password', async () => {
    adminPrompt_register(async () => '', async () => 'pw');
    expect(await adminCredentials_prompt()).toBeNull();

    adminPrompt_register(async () => 'admin', async () => '');
    expect(await adminCredentials_prompt()).toBeNull();
  });
});

describe('adminCredentials_validate', () => {
  it('accepts non-empty credentials and rejects blanks or null', () => {
    expect(adminCredentials_validate({ username: 'a', password: 'p' })).toBe(true);
    expect(adminCredentials_validate({ username: ' ', password: 'p' })).toBe(false);
    expect(adminCredentials_validate({ username: 'a', password: '' })).toBe(false);
    expect(adminCredentials_validate(null)).toBe(false);
  });
});
