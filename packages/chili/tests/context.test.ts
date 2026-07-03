import { Command } from 'commander';
import { contextCommand_setup } from '../src/context/contextCommand';
import { chrisContext, Context, errorStack } from '@fnndsc/cumin';

// Mock only context_getFull from salsa (drives the `get --all` table); the
// rest of salsa runs real against the mocked cumin context.
jest.mock('@fnndsc/salsa', () => ({
  ...jest.requireActual('@fnndsc/salsa'),
  context_getFull: jest.fn(() => ({
    currentUser: 'testuser',
    currentURL: 'http://localhost:8000/api/v1/',
    users: {
      testuser: {
        urls: {
          'http://localhost:8000/api/v1/': {
            folder: '/home/testuser/feeds',
            feed: '1',
            plugin: 'pl-dircopy',
            pacsserver: 'PACSDCM',
            token: 'test-token',
          },
          'http://other:8000/api/v1/': {},
        },
      },
    },
  })),
}));

// Mock the cumin module
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  chrisContext: {
    current_set: jest.fn(),
    current_get: jest.fn(),
    currentContext_update: jest.fn(),
    fullContext_get: jest.fn(),
    singleContext: {
      URL: 'http://localhost:8000/api/v1/',
      user: 'testuser',
      folder: '/home/testuser/feeds',
      feed: '1',
      plugin: 'pl-dircopy',
      token: 'test-token',
    }
  },
  errorStack: {
    allOfType_get: jest.fn().mockReturnValue(['An error occurred']),
  }
}));

describe('context command', () => {
  let program: Command;
  const mockedSetCurrent = chrisContext.current_set as jest.Mock;

  beforeEach(() => {
    program = new Command();
    contextCommand_setup(program);
    mockedSetCurrent.mockClear();
  });

  it('should call current_set with correct user', async () => {
    mockedSetCurrent.mockResolvedValue(true);
    const user = 'newuser';
    await program.parseAsync([
      'node',
      'chili',
      'context',
      'set',
      '--ChRISuser',
      user,
    ]);

    expect(mockedSetCurrent).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrent).toHaveBeenCalledWith(Context.ChRISuser, user);
  });

  it('should call current_set with correct URL', async () => {
    mockedSetCurrent.mockResolvedValue(true);
    const url = 'http://new.chris.url/api/v1/';
    await program.parseAsync([
      'node',
      'chili',
      'context',
      'set',
      '--ChRISurl',
      url,
    ]);

    expect(mockedSetCurrent).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrent).toHaveBeenCalledWith(Context.ChRISURL, url);
  });

  // Example of testing 'get', capturing console.log output
  it('should get the current user', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync([
      'node',
      'chili',
      'context',
      'get',
      '--ChRISuser',
    ]);
    
    // The handler functions join results with newline, let's check for substring
    expect(logSpy.mock.calls[0][0]).toContain('ChRIS User: testuser');
    logSpy.mockRestore();
  });

  it('should get the full context as a table', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Mock the `screen.table_output` call for this specific test
    const { screen } = require('../src/screen/screen.js');
    const tableSpy = jest.spyOn(screen, 'table_output').mockImplementation(() => 'table output');

    await program.parseAsync([
        'node',
        'chili',
        'context',
        'get',
        '--full',
      ]);
    
    expect(tableSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toContain('table output');
    logSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it('should render every user context with --all, highlighting the current one', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'chili', 'context', 'get', '--all']);

    const output: string = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('User: testuser');
    expect(output).toContain('PACSDCM');
    expect(output).toContain('Not set');
    logSpy.mockRestore();
  });
});
