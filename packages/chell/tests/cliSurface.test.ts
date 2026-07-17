/**
 * @file Tests for the CLI surface: capabilities, one-shot prompting (execute
 * and script modes) and persistent prompting on the REPL's readline interface
 * (including hidden-input echo suppression).
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

/** A controllable fake of a readline interface. */
interface FakeInterface {
  question: jest.Mock;
  close: jest.Mock;
}

let lastCreated: FakeInterface | undefined;
let lastCreateOptions: { output?: unknown; terminal?: boolean } | undefined;
const mockCreateInterface = jest.fn((opts: { output?: unknown; terminal?: boolean }): FakeInterface => {
  lastCreateOptions = opts;
  const rl: FakeInterface = {
    // Answer immediately with an untrimmed value to prove trimming.
    question: jest.fn((_prompt: string, cb: (answer: string) => void) => cb('  typed  ')),
    close: jest.fn(),
  };
  lastCreated = rl;
  return rl;
});
jest.unstable_mockModule('readline', () => ({ createInterface: mockCreateInterface }));
// Isolate this surface unit from the engine: cliSurface uses only
// segment_pipeThrough from brasa at runtime (the rest are erased types).
jest.unstable_mockModule('@fnndsc/brasa', () => ({
  segment_pipeThrough: jest.fn(async (): Promise<Buffer> => Buffer.from('')),
}));

const { cliSurface_create } = await import('../src/core/cliSurface.js');

let writeSpy: jest.SpiedFunction<typeof process.stdout.write>;
beforeEach(() => {
  jest.clearAllMocks();
  lastCreated = undefined;
  lastCreateOptions = undefined;
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('cliSurface capabilities', () => {
  it('declares local input and editing, and a tty matching stdout', () => {
    const caps = cliSurface_create().capabilities;
    expect(caps.hiddenInput).toBe(true);
    expect(caps.localEdit).toBe(true);
    expect(caps.tty).toBe(!!process.stdout.isTTY);
  });
});

describe('one-shot prompting (no REPL interface)', () => {
  it('asks a visible question on a fresh interface and trims the answer', async () => {
    const answer = await cliSurface_create().prompt({ message: 'Name? ' });
    expect(mockCreateInterface).toHaveBeenCalledTimes(1);
    expect(lastCreated!.question).toHaveBeenCalledWith('Name? ', expect.any(Function));
    expect(lastCreated!.close).toHaveBeenCalled();
    expect(answer).toBe('typed');
  });

  it('reads hidden input through a muted output and prints the prompt itself', async () => {
    const answer = await cliSurface_create().prompt({ message: 'Password: ', hidden: true });
    // Hidden path builds the interface with a muted output and terminal mode,
    // and writes the prompt to stdout directly (not through readline echo).
    expect(lastCreateOptions!.terminal).toBe(true);
    expect(lastCreateOptions!.output).not.toBe(process.stdout);
    expect(writeSpy).toHaveBeenCalledWith('Password: ');
    expect(answer).toBe('typed');
  });
});

describe('persistent prompting (REPL interface)', () => {
  it('asks a visible question on the provided interface without creating one', async () => {
    const rl = {
      question: jest.fn((_p: string, cb: (a: string) => void) => cb('  hi  ')),
    } as unknown as import('readline').Interface;
    const answer = await cliSurface_create(rl).prompt({ message: 'Q? ' });
    expect(mockCreateInterface).not.toHaveBeenCalled();
    expect(answer).toBe('hi');
  });

  it('suppresses echo for hidden input and restores it afterward', async () => {
    const original = jest.fn();
    let suppressedDuringQuestion: boolean | undefined;
    const rl = {
      _writeToOutput: original,
      question: jest.fn((_p: string, cb: (a: string) => void) => {
        // Capture whether the echo hook was swapped out while awaiting input.
        suppressedDuringQuestion = (rl as unknown as { _writeToOutput: unknown })._writeToOutput !== original;
        cb('secret');
      }),
    };
    const answer = await cliSurface_create(rl as unknown as import('readline').Interface)
      .prompt({ message: 'Password: ', hidden: true });
    expect(suppressedDuringQuestion).toBe(true);
    const passwordWriteIndex: number = writeSpy.mock.calls.findIndex(
      (call: Parameters<typeof process.stdout.write>): boolean => call[0] === 'Password: ',
    );
    expect(passwordWriteIndex).toBeGreaterThanOrEqual(0);
    expect(rl.question.mock.invocationCallOrder[0]).toBeLessThan(
      writeSpy.mock.invocationCallOrder[passwordWriteIndex],
    );
    // Echo restored after the answer arrives: the reinstalled hook delegates
    // back to the original (it is the original re-bound to the interface).
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput('after');
    expect(original).toHaveBeenCalledWith('after');
    expect(writeSpy).toHaveBeenCalledWith('Password: ');
    expect(answer).toBe('secret');
  });
});
