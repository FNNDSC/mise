import { describe, it, expect } from '@jest/globals';
import { semicolons_parse } from '../src/lib/semicolonParser.js';

describe('semicolons_parse', () => {
  it('should return single command unchanged', () => {
    expect(semicolons_parse('ls /home')).toEqual(['ls /home']);
  });

  it('should split semicolon-separated commands', () => {
    expect(semicolons_parse('ls; pwd')).toEqual(['ls', 'pwd']);
  });

  it('should split multiple commands with semicolons', () => {
    expect(semicolons_parse('cd /tmp; ls; pwd')).toEqual(['cd /tmp', 'ls', 'pwd']);
  });

  it('should trim whitespace around commands', () => {
    expect(semicolons_parse('ls  ;  pwd  ;  cd /tmp')).toEqual(['ls', 'pwd', 'cd /tmp']);
  });

  it('should preserve semicolons inside single quotes', () => {
    expect(semicolons_parse("echo 'a;b'; pwd")).toEqual(["echo 'a;b'", "pwd"]);
  });

  it('should preserve semicolons inside double quotes', () => {
    expect(semicolons_parse('echo "a;b"; pwd')).toEqual(['echo "a;b"', 'pwd']);
  });

  it('should handle mixed quotes and semicolons', () => {
    expect(semicolons_parse('echo "hello;world"; ls; echo \'foo;bar\'')).toEqual([
      'echo "hello;world"',
      'ls',
      "echo 'foo;bar'"
    ]);
  });

  it('should handle nested quotes', () => {
    expect(semicolons_parse('echo "it\'s;ok"; pwd')).toEqual(['echo "it\'s;ok"', 'pwd']);
  });

  it('should ignore empty commands from consecutive semicolons', () => {
    expect(semicolons_parse('ls;; pwd')).toEqual(['ls', 'pwd']);
  });

  it('should ignore trailing semicolons', () => {
    expect(semicolons_parse('ls; pwd;')).toEqual(['ls', 'pwd']);
  });

  it('should ignore leading semicolons', () => {
    expect(semicolons_parse('; ls; pwd')).toEqual(['ls', 'pwd']);
  });

  it('should handle empty string', () => {
    expect(semicolons_parse('')).toEqual([]);
  });

  it('should handle only semicolons', () => {
    expect(semicolons_parse(';;;')).toEqual([]);
  });

  it('should handle complex command with pipes and semicolons', () => {
    expect(semicolons_parse('cat file.txt | grep test; ls -la')).toEqual([
      'cat file.txt | grep test',
      'ls -la'
    ]);
  });

  it('should handle quotes with special characters', () => {
    expect(semicolons_parse('echo "line1;line2"; echo \'line3;line4\'')).toEqual([
      'echo "line1;line2"',
      "echo 'line3;line4'"
    ]);
  });
});
