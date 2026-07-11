import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  text_boxFormat,
  commandHelp_get,
  help_show,
  args_checkHasHelpFlag,
  builtin_help,
  builtinCommands_list,
  builtinCommand_descriptionGet,
} from '../src/builtins/help.js';

let logSpy: jest.SpiedFunction<typeof console.log>;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('text_boxFormat', () => {
  it('indents a short string on a single line', () => {
    expect(text_boxFormat('hello', 78, 2)).toBe('  hello');
  });

  it('honours a custom indent', () => {
    expect(text_boxFormat('x', 78, 4)).toBe('    x');
  });

  it('wraps words that exceed the content width', () => {
    expect(text_boxFormat('aaa bbb ccc', 10, 0)).toBe('aaa bbb\nccc');
  });

  it('collapses runs of whitespace', () => {
    expect(text_boxFormat('a    b', 78, 0)).toBe('a b');
  });
});

describe('commandHelp_get', () => {
  it('renders the sections for a known command', () => {
    const help = commandHelp_get('ls');
    expect(help).toBeDefined();
    expect(help).toContain('LS');
    expect(help).toContain('USAGE');
    expect(help).toContain('DESCRIPTION');
  });

  it('returns undefined for an unknown command', () => {
    expect(commandHelp_get('nonexistentcmd')).toBeUndefined();
  });
});

describe('help_show', () => {
  it('prints the rendered help for a known command', () => {
    help_show('ls');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('USAGE'));
  });

  it('notes when no help exists', () => {
    help_show('nonexistentcmd');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No help available'));
  });
});

describe('args_checkHasHelpFlag', () => {
  it('detects --help', () => {
    expect(args_checkHasHelpFlag(['--help'])).toBe(true);
  });

  it('detects -h by default', () => {
    expect(args_checkHasHelpFlag(['-h'])).toBe(true);
  });

  it('treats -h as human-readable for ls and du', () => {
    expect(args_checkHasHelpFlag(['-h'], 'ls')).toBe(false);
    expect(args_checkHasHelpFlag(['-h'], 'du')).toBe(false);
  });

  it('does not treat --help as help for a plugin-executable name', () => {
    expect(args_checkHasHelpFlag(['--help'], 'pl-dircopy-v1.0')).toBe(false);
  });

  it('returns false with no flags', () => {
    expect(args_checkHasHelpFlag([])).toBe(false);
  });
});

describe('builtin_help', () => {
  it('lists commands by category with no argument', async () => {
    await builtin_help([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));
  });

  it('shows a specific command help when named', async () => {
    await builtin_help(['ls']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('USAGE'));
  });
});

describe('help metadata accessors', () => {
  it('lists the known builtin commands', () => {
    const commands = builtinCommands_list();
    expect(commands.length).toBeGreaterThan(0);
    expect(commands).toContain('ls');
    expect(commands).toContain('cd');
  });

  it('returns a description for a known command', () => {
    expect(typeof builtinCommand_descriptionGet('ls')).toBe('string');
  });

  it('returns undefined for an unknown command description', () => {
    expect(builtinCommand_descriptionGet('nonexistentcmd')).toBeUndefined();
  });
});
