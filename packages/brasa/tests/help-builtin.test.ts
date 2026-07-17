import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  text_boxFormat,
  commandHelp_get,
  help_render,
  pluginExecutableHelp_render,
  pipelineExecutableHelp_render,
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

describe('help_render', () => {
  it('returns the rendered help for a known command', () => {
    expect(help_render('ls')).toContain('USAGE');
  });

  it('notes when no help exists', () => {
    expect(help_render('nonexistentcmd')).toContain('No help available');
  });

  it('renders dynamic pipeline executable operations', () => {
    const help: string = pipelineExecutableHelp_render('US_DICOM_id127');
    expect(help).toContain('US_DICOM_id127');
    expect(help).toContain('--diagram --withargs');
    expect(help).toContain('--signalflow');
    expect(help).toContain('--source, --readme');
  });

  it('renders dynamic plugin executable operations', () => {
    const help: string = pluginExecutableHelp_render('pl-dircopy-v2.1.3');
    expect(help).toContain('pl-dircopy-v2.1.3');
    expect(help).toContain('--parameters');
    expect(help).toContain('--readme --raw');
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
    const envelope = await builtin_help([]);
    expect(envelope.rendered).toContain('Available Commands');
  });

  it('shows a specific command help when named', async () => {
    const envelope = await builtin_help(['ls']);
    expect(envelope.rendered).toContain('USAGE');
  });

  it('shows plugin executable help when a versioned plugin is named', async () => {
    const envelope = await builtin_help(['pl-dircopy-v2.1.3']);
    expect(envelope.rendered).toContain('pl-dircopy-v2.1.3');
    expect(envelope.rendered).toContain('--parameters');
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
