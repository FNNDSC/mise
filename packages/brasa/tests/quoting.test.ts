/**
 * @file POSIX quoting, read alike by every parser that splits a line (#1258).
 *
 * In single quotes a backslash is a character; in double quotes it escapes
 * only $ ` " \ and newline; outside quotes it escapes the next character.
 * The word parser and the `;`, `|`, `>` and `$( … )` splitters must agree,
 * or a line splits one way and its words read another.
 */
import { describe, it, expect } from '@jest/globals';
import { backslash_escapesNext } from '../src/lib/quoting.js';
import { args_tokenize } from '../src/lib/parser.js';
import { semicolons_parse } from '../src/lib/semicolonParser.js';
import { pipes_parse, redirect_parse } from '../src/core/preprocess.js';
import { substitution_end } from '../src/core/variables.js';

describe('backslash_escapesNext', () => {
  it('never in single quotes; in double quotes only before $ ` " \\ and newline; always outside', () => {
    expect(backslash_escapesNext(true, false, 'n')).toBe(false);
    expect(backslash_escapesNext(true, false, "'")).toBe(false);
    for (const next of ['$', '`', '"', '\\', '\n']) expect(backslash_escapesNext(false, true, next)).toBe(true);
    for (const next of ['n', '.', 'd', "'"]) expect(backslash_escapesNext(false, true, next)).toBe(false);
    for (const next of ['n', ' ', ';', "'"]) expect(backslash_escapesNext(false, false, next)).toBe(true);
    expect(backslash_escapesNext(false, true, undefined)).toBe(false);
  });
});

describe('words, as POSIX quoting reads them', () => {
  it('keeps a backslash in single quotes: a printf format, a grep pattern', () => {
    expect(args_tokenize("printf '%s\\n' a")).toEqual(['printf', '%s\\n', 'a']);
    expect(args_tokenize("grep '\\.mgz$'")).toEqual(['grep', '\\.mgz$']);
    expect(args_tokenize("echo 'a\\'")).toEqual(['echo', 'a\\']);
  });

  it('escapes in double quotes only what POSIX escapes there', () => {
    expect(args_tokenize('echo "a\\"b"')).toEqual(['echo', 'a"b']);
    expect(args_tokenize('echo "\\$HOME"')).toEqual(['echo', '$HOME']);
    expect(args_tokenize('echo "a\\\\b"')).toEqual(['echo', 'a\\b']);
    expect(args_tokenize('echo "a\\b"')).toEqual(['echo', 'a\\b']);
    expect(args_tokenize('printf "%s\\n" a')).toEqual(['printf', '%s\\n', 'a']);
  });

  it('escapes the next character outside quotes', () => {
    expect(args_tokenize('echo a\\ b')).toEqual(['echo', 'a b']);
    expect(args_tokenize('echo \\$HOME')).toEqual(['echo', '$HOME']);
    expect(args_tokenize("echo it\\'s")).toEqual(['echo', "it's"]);
  });
});

describe('every splitter agrees with the words', () => {
  // Each line: what `;`, `|` and `>` see, with the operator inside or outside quotes.
  const table: Array<{ line: string; commands: number; segments: number; redirect: boolean }> = [
    { line: "echo 'a;b|c>d'", commands: 1, segments: 1, redirect: false },
    { line: 'echo "a;b|c>d"', commands: 1, segments: 1, redirect: false },
    { line: "echo 'a\\'; pwd", commands: 2, segments: 1, redirect: false },
    { line: "echo 'a\\' | wc", commands: 1, segments: 2, redirect: false },
    { line: "echo 'a\\' > f", commands: 1, segments: 1, redirect: true },
    { line: 'echo "a\\"; b" ; pwd', commands: 2, segments: 1, redirect: false },
    { line: 'echo "a\\"| b" | wc', commands: 1, segments: 2, redirect: false },
    { line: 'echo a\\;b\\|c\\>d', commands: 1, segments: 1, redirect: false },
  ];
  for (const row of table) {
    it(`splits ${row.line} the same way the words read it`, () => {
      expect(semicolons_parse(row.line)).toHaveLength(row.commands);
      expect(pipes_parse(row.line)).toHaveLength(row.segments);
      expect(redirect_parse(row.line) !== null).toBe(row.redirect);
    });
  }

  it('closes $( … ) where the words would: a ) in quotes is text, a backslash in single quotes a character', () => {
    expect(substitution_end("$(printf '%s)' x) tail", 0)).toBe("$(printf '%s)' x)".length - 1);
    expect(substitution_end("$(echo 'a\\') tail", 0)).toBe("$(echo 'a\\')".length - 1);
    expect(substitution_end('$(echo "a\\")") tail', 0)).toBe('$(echo "a\\")")'.length - 1);
  });
});
