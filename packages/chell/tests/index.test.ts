import { chell_start } from '../src/index';
import { session } from '../src/session/index';
import { REPL } from '../src/core/repl';

jest.mock('../src/session/index');
jest.mock('../src/core/repl');

describe('chell entry point', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.clearAllMocks();
    process.argv = ['node', 'chell'];
  });

  afterAll(() => {
    process.argv = originalArgv;
  });

  it('should initialize session and start REPL when no args', async () => {
    await chell_start();
    expect(session.init).toHaveBeenCalled();
    expect(REPL.prototype.start).toHaveBeenCalled();
  });
});