/**
 * Tests for ui (readline prompt) and docker (child_process wrappers).
 */
jest.mock('readline');
jest.mock('child_process');

import readline from 'readline';
import { exec } from 'child_process';
import { prompt_confirm } from '../src/utils/ui';
import {
  childProcess_exec,
  shellCommand_run,
  shellCommand_runWithDetails,
  docker_checkAvailability,
  docker_imageExistsLocally,
  docker_pullImage,
  docker_getImageCmd,
} from '../src/utils/docker';

const execMock = exec as unknown as jest.Mock;

/** Route exec by command substring -> stdout, or an error. */
function execRouter(routes: Array<[string, string | Error]>): void {
  execMock.mockImplementation((cmd: string, cb: (e: Error | null, o: string, s: string) => void) => {
    for (const [needle, result] of routes) {
      if (cmd.includes(needle)) {
        if (result instanceof Error) return cb(result, '', '');
        return cb(null, result, '');
      }
    }
    return cb(null, '', '');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('prompt_confirm', () => {
  it.each([
    ['y', true],
    ['n', false],
    ['', false],
  ])('answer %s -> %s', async (answer, expected) => {
    (readline.createInterface as jest.Mock).mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb(answer),
      close: jest.fn(),
    });
    expect(await prompt_confirm('OK?')).toBe(expected);
  });
});

describe('childProcess_exec', () => {
  it('resolves with stdout/stderr', async () => {
    execRouter([['echo', 'hi']]);
    await expect(childProcess_exec('echo hi')).resolves.toEqual({ stdout: 'hi', stderr: '' });
  });
  it('rejects on error', async () => {
    execRouter([['bad', new Error('boom')]]);
    await expect(childProcess_exec('bad')).rejects.toThrow('boom');
  });
});

describe('shellCommand_run', () => {
  it('returns trimmed stdout', async () => {
    execRouter([['ls', '  out  ']]);
    expect(await shellCommand_run('ls')).toBe('out');
  });
  it('returns null on failure', async () => {
    execRouter([['ls', new Error('x')]]);
    expect(await shellCommand_run('ls')).toBeNull();
  });
});

describe('shellCommand_runWithDetails', () => {
  it('reports success', async () => {
    execRouter([['ls', 'out']]);
    expect(await shellCommand_runWithDetails('ls')).toEqual({ stdout: 'out', stderr: '', success: true });
  });
  it('reports failure with the error message', async () => {
    execRouter([['ls', new Error('nope')]]);
    const r = await shellCommand_runWithDetails('ls');
    expect(r.success).toBe(false);
    expect(r.error).toBe('nope');
  });
});

describe('docker helpers', () => {
  it('docker_checkAvailability true/false', async () => {
    execRouter([['docker info', 'OK']]);
    expect(await docker_checkAvailability()).toBe(true);
    execRouter([['docker info', new Error('no docker')]]);
    expect(await docker_checkAvailability()).toBe(false);
  });

  it('docker_imageExistsLocally reflects a non-empty image id', async () => {
    execRouter([['docker images', 'abc123']]);
    expect(await docker_imageExistsLocally('pl-x')).toBe(true);
    execRouter([['docker images', '']]);
    expect(await docker_imageExistsLocally('pl-x')).toBe(false);
  });

  it('docker_pullImage skips when the image exists', async () => {
    execRouter([['docker images', 'abc']]);
    expect(await docker_pullImage('pl-x')).toBe(true);
  });

  it('docker_pullImage pulls when absent', async () => {
    execRouter([['docker images', ''], ['docker pull', 'done']]);
    expect(await docker_pullImage('pl-x')).toBe(true);
  });

  it('docker_pullImage returns false when the pull fails', async () => {
    execRouter([['docker images', ''], ['docker pull', new Error('fail')]]);
    expect(await docker_pullImage('pl-x')).toBe(false);
  });

  it('docker_getImageCmd parses a JSON array, else []', async () => {
    execRouter([['docker inspect', '["civet.py"]']]);
    expect(await docker_getImageCmd('pl-x')).toEqual(['civet.py']);
    execRouter([['docker inspect', 'null']]);
    expect(await docker_getImageCmd('pl-x')).toEqual([]);
    execRouter([['docker inspect', 'not json']]);
    expect(await docker_getImageCmd('pl-x')).toEqual([]);
  });
});
