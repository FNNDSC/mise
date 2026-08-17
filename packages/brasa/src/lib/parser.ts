/**
 * @file Command line argument tokenizer.
 *
 * Splits a command line into words while respecting single/double quotes and
 * backslash escapes. Quotes are stripped from rendered values, but their
 * pathname-expansion meaning is retained.
 */

/** A rendered shell word and the glob pattern it may contribute. */
export interface ShellWord {
  value: string;
  globPattern: string;
  pathnameExpansion: boolean;
  pathnameExpanded: boolean;
}

/** String arguments with per-operand pathname-expansion provenance. */
export type ShellArguments = string[] & {
  pathnameExpanded?: readonly boolean[];
  pathnameExpansion?: readonly boolean[];
};

/** Escapes wildcard metacharacters for literal minimatch use. */
function globLiteral_escape(value: string): string {
  return value.replace(/[\\*?\[\]]/g, '\\$&');
}

/**
 * Creates a shell word from a literal value.
 *
 * @param value - Rendered word value.
 * @returns A word that cannot trigger pathname expansion.
 */
export function shellWord_literal(value: string): ShellWord {
  return {
    value,
    globPattern: globLiteral_escape(value),
    pathnameExpansion: false,
    pathnameExpanded: false,
  };
}

/**
 * Creates an unquoted shell word from a compatibility string value.
 *
 * @param value - Rendered word value.
 * @returns A word whose wildcard syntax is eligible for pathname expansion.
 */
export function shellWord_unquoted(value: string): ShellWord {
  return {
    value,
    globPattern: value,
    pathnameExpansion: /[*?[\]]/.test(value),
    pathnameExpanded: false,
  };
}

/**
 * Converts shell words to compatibility string arguments.
 *
 * @param words - Parsed or expanded shell words.
 * @returns String arguments annotated with expansion provenance.
 */
export function shellWords_values(words: readonly ShellWord[]): ShellArguments {
  const values: ShellArguments = words.map((word: ShellWord): string => word.value) as ShellArguments;
  Object.defineProperty(values, 'pathnameExpanded', {
    value: words.map((word: ShellWord): boolean => word.pathnameExpanded),
    enumerable: false,
  });
  Object.defineProperty(values, 'pathnameExpansion', {
    value: words.map((word: ShellWord): boolean => word.pathnameExpansion),
    enumerable: false,
  });
  return values;
}

/**
 * Checks whether one compatibility argument was produced by pathname expansion.
 *
 * @param args - String arguments created by {@link shellWords_values}.
 * @param index - Argument position to inspect.
 * @returns True when the argument was produced by pathname expansion.
 */
export function shellArguments_pathnameExpanded(args: readonly string[], index: number): boolean {
  const expanded: readonly boolean[] | undefined = (args as ShellArguments).pathnameExpanded;
  return expanded?.[index] === true;
}

/**
 * Checks whether one compatibility argument contained unquoted wildcard syntax.
 *
 * @param args - String arguments created by {@link shellWords_values}.
 * @param index - Argument position to inspect.
 * @returns True when the source word allowed pathname expansion.
 */
export function shellArguments_pathnameExpansion(args: readonly string[], index: number): boolean {
  const expansion: readonly boolean[] | undefined = (args as ShellArguments).pathnameExpansion;
  return expansion?.[index] === true;
}

/**
 * Applies environment substitution without discarding shell-word provenance.
 *
 * @param args - Compatibility arguments with pathname metadata.
 * @param expand - Per-token environment substitution function.
 * @returns Substituted arguments retaining the original pathname metadata.
 */
export function shellArguments_envRefsExpand(
  args: readonly string[],
  expand: (value: string) => string,
): ShellArguments {
  const values: ShellArguments = args.map(expand) as ShellArguments;
  const source: ShellArguments = args as ShellArguments;
  Object.defineProperty(values, 'pathnameExpanded', {
    value: source.pathnameExpanded,
    enumerable: false,
  });
  Object.defineProperty(values, 'pathnameExpansion', {
    value: source.pathnameExpansion,
    enumerable: false,
  });
  return values;
}

/**
 * Slices compatibility arguments while rebasing pathname metadata.
 *
 * @param args - Compatibility arguments with pathname metadata.
 * @param start - Inclusive offset of the first returned argument.
 * @returns The sliced arguments with matching provenance entries.
 */
export function shellArguments_slice(args: readonly string[], start: number): ShellArguments {
  const source: ShellArguments = args as ShellArguments;
  const values: ShellArguments = args.slice(start) as ShellArguments;
  Object.defineProperty(values, 'pathnameExpanded', {
    value: source.pathnameExpanded?.slice(start),
    enumerable: false,
  });
  Object.defineProperty(values, 'pathnameExpansion', {
    value: source.pathnameExpansion?.slice(start),
    enumerable: false,
  });
  return values;
}

/**
 * Tokenizes a line while preserving quote and escape provenance for globbing.
 *
 * @param line - Raw command line input.
 * @returns Parsed shell words with rendered and glob-pattern representations.
 */
export function shellWords_tokenize(line: string): ShellWord[] {
  const tokens: ShellWord[] = [];
  let currentValue: string = '';
  let currentPattern: string = '';
  let pathnameExpansion: boolean = false;
  let wordStarted: boolean = false;
  let inSingle: boolean = false;
  let inDouble: boolean = false;
  let escapeNext: boolean = false;

  const character_append = (char: string, literal: boolean): void => {
    currentValue += char;
    currentPattern += literal ? globLiteral_escape(char) : char;
    pathnameExpansion ||= !literal && /[*?[\]]/.test(char);
    wordStarted = true;
  };
  const word_pushCurrent = (): void => {
    if (!wordStarted) return;
    tokens.push({
      value: currentValue,
      globPattern: currentPattern,
      pathnameExpansion,
      pathnameExpanded: false,
    });
    currentValue = '';
    currentPattern = '';
    pathnameExpansion = false;
    wordStarted = false;
  };

  for (let i = 0; i < line.length; i++) {
    const char: string = line[i];

    if (escapeNext) {
      character_append(char, true);
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      wordStarted = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      wordStarted = true;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      wordStarted = true;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(char)) {
      word_pushCurrent();
      continue;
    }

    character_append(char, inSingle || inDouble);
  }

  word_pushCurrent();
  return tokens;
}

/**
 * Tokenizes a command line preserving quoted segments with spaces.
 *
 * @param line - Raw command line input.
 * @returns Array of tokens with quotes removed.
 */
export function args_tokenize(line: string): string[] {
  return shellWords_tokenize(line).map((word: ShellWord): string => word.value);
}
