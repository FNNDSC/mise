import { completer } from '../src/lib/completer/index.js';

describe('completer', () => {
  it('should return all builtins for empty string', () => {
    const [hits, line] = completer('');
    expect(hits).toContain('ls');
    expect(hits).toContain('cd');
    expect(line).toBe('');
  });

  it('should return partial matches', () => {
    const [hits, line] = completer('con');
    expect(hits).toEqual(['connect']);
    expect(line).toBe('con');
  });

  it('should return no matches for unknown command', () => {
    const [hits, line] = completer('xyz');
    expect(hits).toEqual([]); 
  });
});
