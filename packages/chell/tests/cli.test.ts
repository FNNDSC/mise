import { describe, it, expect } from '@jest/globals';
import { cli_parse, ChellCLIConfig } from '../src/core/cli.js';
import { fileURLToPath } from 'url';
import path from 'path';

describe('CLI Parser', () => {
  const VERSION = '1.0.0';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  it('should return interactive mode by default', async () => {
    const config = await cli_parse(['node', 'chell'], VERSION);
    expect(config.mode).toBe('interactive');
  });

  it('should handle --help', async () => {
    const config = await cli_parse(['node', 'chell', '--help'], VERSION);
    expect(config.mode).toBe('help');
    expect(config.output).toContain('Usage: chell');
  });

  it('should handle --version', async () => {
    const config = await cli_parse(['node', 'chell', '--version'], VERSION);
    expect(config.mode).toBe('version');
    expect(config.output).toBe(VERSION);
  });

  it('should parse connection args', async () => {
    const args = ['node', 'chell', 'http://cube.example.org', '-u', 'testuser', '-p', 'testpass'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('connect');
    expect(config.connectConfig).toBeDefined();
    expect(config.connectConfig?.url).toBe('http://cube.example.org');
    expect(config.connectConfig?.user).toBe('testuser');
    expect(config.connectConfig?.password).toBe('testpass');
  });

  it('should auto-prepend http protocol if missing', async () => {
    const args = ['node', 'chell', 'cube.example.org', '-u', 'testuser'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('connect');
    expect(config.connectConfig?.url).toBe('http://cube.example.org');
  });

  it('should parse user@url syntax', async () => {
    const args = ['node', 'chell', 'chris@cube.example.org'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('connect');
    expect(config.connectConfig?.url).toBe('http://cube.example.org');
    expect(config.connectConfig?.user).toBe('chris');
  });

  it('should respect existing https protocol', async () => {
    const args = ['node', 'chell', 'https://secure.cube.org', '-u', 'user'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('connect');
    expect(config.connectConfig?.url).toBe('https://secure.cube.org');
  });

  it('should return help for unknown options', async () => {
    const args = ['node', 'chell', '--unknown-flag'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('help');
    expect(config.output).toBeDefined();
  });

  it('should return help for missing option argument', async () => {
    const args = ['node', 'chell', 'url', '-u']; // Missing user
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('help');
  });

  it('should parse -c command flag', async () => {
    const args = ['node', 'chell', '-c', 'ls /home'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('execute');
    expect(config.commandToExecute).toBe('ls /home');
  });

  it('should parse -c with semicolon-separated commands', async () => {
    const args = ['node', 'chell', '-c', 'pwd; ls /home; pwd'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('execute');
    expect(config.commandToExecute).toBe('pwd; ls /home; pwd');
  });

  it('should parse -f script file flag', async () => {
    const args = ['node', 'chell', '-f', 'script.chell'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('script');
    expect(config.scriptFile).toBe('script.chell');
    expect(config.stopOnError).toBe(false);
  });

  it('should parse -e stop-on-error flag with -c', async () => {
    const args = ['node', 'chell', '-c', 'ls', '-e'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('execute');
    expect(config.stopOnError).toBe(true);
  });

  it('should parse -e stop-on-error flag with -f', async () => {
    const args = ['node', 'chell', '-f', 'script.chell', '-e'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('script');
    expect(config.stopOnError).toBe(true);
  });

  it('should auto-detect existing file as script', async () => {
    // Using this test file itself as it exists
    const args = ['node', 'chell', __filename];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('script');
    expect(config.scriptFile).toBe(__filename);
  });

  it('should treat non-existent path as connection URL', async () => {
    const args = ['node', 'chell', 'http://nonexistent.example.com'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('connect');
    expect(config.connectConfig?.url).toBe('http://nonexistent.example.com');
  });

  it('should prioritize -f flag over auto-detection', async () => {
    const args = ['node', 'chell', '-f', 'explicit.chell', __filename];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('script');
    expect(config.scriptFile).toBe('explicit.chell');
  });

  it('should set physicalFS mode with script', async () => {
    const args = ['node', 'chell', '-f', 'script.chell', '--physicalFS'];
    const config = await cli_parse(args, VERSION);
    expect(config.mode).toBe('script');
    expect(config.physicalFS).toBe(true);
  });
});
