/**
 * @file Unit tests for `echo` and `printf`: words on a line, POSIX's printf
 * subset, and refusing by name what other echos and printfs do but these do not.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';

const { builtin_echo, builtin_printf, printf_format } = await import('../src/builtins/sys/echo.js');

beforeEach(() => {
  process.exitCode = 0;
});

describe('echo', () => {
  it('writes its words joined by a space, on one line, with no model, as text answers', async () => {
    const envelope = await builtin_echo(['feed', '5596']);
    expect(envelope.rendered).toBe('feed 5596\n');
    expect(envelope.model).toBeUndefined();
  });

  it('writes an empty line when given nothing', async () => {
    expect((await builtin_echo([])).rendered).toBe('\n');
  });

  it('keeps a backslash and a dash-word as written', async () => {
    expect((await builtin_echo(['a\\nb', '-5'])).rendered).toBe('a\\nb -5\n');
  });

  it('reads a dash-option only at the front; later it is a word', async () => {
    expect((await builtin_echo(['use', '-n', 'here'])).rendered).toBe('use -n here\n');
  });

  it("refuses other echos' options by name", async () => {
    const envelope = await builtin_echo(['-n', 'hi']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('echo: -n: echo takes no options');
    expect(process.exitCode).toBe(1);
  });
});

describe('printf', () => {
  it('writes words and whole numbers under the format', () => {
    expect(printf_format('feed %s: %d jobs\\n', ['5596', '4'])).toEqual({ text: 'feed 5596: 4 jobs\n' });
  });

  it('pads and cuts as flags, width and precision say', () => {
    expect(printf_format('[%-5s][%5s][%.2s][%05d][%+d][%.3d]', ['ab', 'cd', 'xyz', '-42', '7', '5'])).toEqual({ text: '[ab   ][   cd][xy][-0042][+7][005]' });
  });

  it('reads an empty argument as 0 for %d, as a missing one', () => {
    expect(printf_format('[%d][%i]', ['', ''])).toEqual({ text: '[0][0]' });
  });

  it('writes the format again while arguments remain', () => {
    expect(printf_format('%s=%d\\n', ['a', '1', 'b', '2', 'c'])).toEqual({ text: 'a=1\nb=2\nc=0\n' });
  });

  it('writes the format once when it takes no argument', () => {
    expect(printf_format('100%%\\tdone', ['ignored'])).toEqual({ text: '100%\tdone' });
  });

  it('refuses a conversion, an escape or a number it does not read, by name', () => {
    expect(printf_format('%f', ['1'])).toEqual({ refused: 'printf: %f: not a conversion printf here does; it does %s, %d and %i' });
    expect(printf_format('a\\b', [])).toEqual({ refused: 'printf: \\b: not an escape printf here reads; it reads \\n, \\t and \\\\' });
    expect(printf_format('%d', ['x'])).toEqual({ refused: 'printf: x: not a whole number, for %d' });
    expect(printf_format('50%', [])).toEqual({ refused: 'printf: %: a % with no conversion; %% writes one' });
    expect(printf_format('%#x', ['1'])).toEqual({ refused: 'printf: the # flag is not read here; it reads - 0 + and space' });
    expect(printf_format('%*d', ['3', '1'])).toEqual({ refused: 'printf: a * width or precision is not read here; write the number in the format' });
    expect(printf_format('%.*s', ['2', 'abc'])).toEqual({ refused: 'printf: a * width or precision is not read here; write the number in the format' });
  });

  it('ends the line and answers with text alone', async () => {
    const envelope = await builtin_printf(['%s-%03d', 'scan', '7']);
    expect(envelope.rendered).toBe('scan-007\n');
    expect(envelope.model).toBeUndefined();
  });

  it('wants a format', async () => {
    const envelope = await builtin_printf([]);
    expect(envelope.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });
});
