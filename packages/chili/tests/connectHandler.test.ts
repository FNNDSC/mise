/**
 * Tests for connectCommand_setup — drives the commander actions via parseAsync.
 * The command implementations are mocked; the (pure) views are real.
 */
const mockLogin = jest.fn();
const mockLogout = jest.fn();

jest.mock('../src/commands/connect/login', () => ({ connect_login: mockLogin }));
jest.mock('../src/commands/connect/logout', () => ({ connect_logout: mockLogout }));

import { Command } from 'commander';
import { connectCommand_setup } from '../src/connect/connectHandler';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  connectCommand_setup(program);
  program.commands.forEach((c) => c.exitOverride());
  return program;
}

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('connect command', () => {
  it('logs success when login succeeds', async () => {
    mockLogin.mockResolvedValue(true);
    await buildProgram().parseAsync(['connect', 'http://c/', '-u', 'chris', '-p', 'pw'], { from: 'user' });
    expect(mockLogin).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://c/', user: 'chris', password: 'pw' }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully connected'));
  });

  it('reports failure when login throws', async () => {
    mockLogin.mockRejectedValue(new Error('bad creds'));
    await buildProgram().parseAsync(['connect', 'http://c/', '-u', 'chris'], { from: 'user' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to connect'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('bad creds'));
  });
});

describe('logout command', () => {
  it('logs success on logout', async () => {
    mockLogout.mockResolvedValue(undefined);
    await buildProgram().parseAsync(['logout'], { from: 'user' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Logged out'));
  });

  it('reports failure when logout throws', async () => {
    mockLogout.mockRejectedValue(new Error('oops'));
    await buildProgram().parseAsync(['logout'], { from: 'user' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Logout failed'));
    expect(errSpy).toHaveBeenCalled();
  });
});
