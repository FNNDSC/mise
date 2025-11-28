import { describe, it, expect } from '@jest/globals';
import { cli_parse, ChellCLIConfig } from '../src/core/cli.js';

describe('CLI Parser', () => {
  const VERSION = '1.0.0';

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
});
