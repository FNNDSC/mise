/**
 * @file REPL Autocompletion.
 *
 * Provides tab-completion logic for the REPL, including built-in commands
 * and path completion.
 *
 * @module
 */
import { session } from '../../session/index.js';
import type { ListingItem } from '@fnndsc/menu';
import { listingItemsFromVfs_make } from '../vfs/listing.js';
import { partialPath_split, completions_build } from './pathComplete.helpers.js';
import { backendInstalled_get, type ListingCache } from '../../core/backend.js';
import { listingCache_get, vfsDispatcher_get } from '../../core/filesystem.js';
import * as path from 'path';
import { builtinCommands_list } from '../../builtins/help.js';
import { args_tokenize } from '../parser.js';

/**
 * Callback function type for autocomplete results.
 * @param err - Error if completion failed, null otherwise.
 * @param result - Tuple of [matches array, original input string].
 */
type CompleterCallback = (err: Error | null, result: [string[], string]) => void;

interface CompletionWord {
  raw: string;
  value: string;
  quote: "'" | '"' | null;
}

function completionWord_get(line: string): CompletionWord {
  let start: number = 0;
  let quote: "'" | '"' | null = null;
  let escapeNext: boolean = false;

  for (let index: number = 0; index < line.length; index++) {
    const char: string = line[index];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escapeNext = true;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      start = index + 1;
    }
  }

  const raw: string = line.substring(start);
  const tokens: string[] = args_tokenize(raw);
  const value: string = tokens.length > 0 ? tokens[0] : '';
  const openingQuote: "'" | '"' | null =
    raw.startsWith("'") ? "'" : raw.startsWith('"') ? '"' : null;
  return { raw, value, quote: openingQuote };
}

function completion_format(completion: string, word: CompletionWord): string {
  if (word.quote === "'") {
    return `'${completion.replace(/'/g, `'\\''`)}`;
  }
  if (word.quote === '"') {
    return `"${completion.replace(/(["\\])/g, '\\$1')}`;
  }
  return completion.replace(/([\\\s'"`])/g, '\\$1');
}


/**
 * Computes autocomplete suggestions for a given input line.
 * Uses the callback style to support asynchronous operations (fetching files).
 *
 * @param line - The current input line.
 * @param callback - The callback function to return results.
 */
export function input_complete(line: string, callback: CompleterCallback): void {
  const trimmed: string = line.trimStart();
  const args: string[] = args_tokenize(trimmed);

  // Case 1: Command Completion (First word)
  // If we have only one token and the line doesn't end with space, we are typing the command
  // Or if line is empty
  const isCommandCompletion: boolean = args.length === 0 || (args.length === 1 && !line.endsWith(' '));

  if (isCommandCompletion) {
    // Check builtins first (instant, no async)
    const builtinHits: string[] = builtinCommands_list().filter((c: string) => c.startsWith(trimmed));

    // Always check plugins and combine results
    commandWords_get().then((pluginNames) => {
      const pluginHits: string[] = pluginNames.filter((c) => c.startsWith(trimmed));
      
      // Combine both builtins and plugins
      const allHits: string[] = [...builtinHits, ...pluginHits];
      callback(null, [allHits, trimmed]);
    }).catch(() => {
      // On error, return only builtin matches
      callback(null, [builtinHits, trimmed]);
    });
    return;
  }

  const compoundWord: CompletionWord = completionWord_get(line);
  const options: ((args: string[], word: string) => Promise<string[] | null>) | undefined = backendInstalled_get()?.completion?.options;
  if (compoundWord.value.startsWith('--') && options !== undefined) {
    options(args, compoundWord.value).then((found: string[] | null): void => {
      if (found === null) {
        argumentCompletion_run(line, args, callback);
        return;
      }
      callback(null, [found, compoundWord.raw]);
    }).catch(() => callback(null, [[], compoundWord.raw]));
    return;
  }

  argumentCompletion_run(line, args, callback);
}

/**
 * Completes an argument: a path, for the commands that take one.
 *
 * @param line - The input line.
 * @param args - Its words.
 * @param callback - Where the completions go.
 */
function argumentCompletion_run(line: string, args: string[], callback: CompleterCallback): void {
  // Case 2: Path Completion (Argument to specific commands)
  const cmd: string = args[0];
  if (['cd', 'ls', 'mkdir', 'rmdir', 'chmod', 'touch', 'cat', 'edit', 'cp', 'mv', 'rm', 'upload', 'download', 'du', 'tree', 'pull', 'cubepath', 'query', 'image', 'dcm'].includes(cmd)) {
    const word: CompletionWord = completionWord_get(line);
    
    path_complete(word.value).then((matches) => {
        callback(null, [matches.map((match: string) => completion_format(match, word)), word.raw]);
    }).catch((err) => {
        // On error, return no matches, don't crash REPL
        callback(null, [[], word.raw]);
    });
    return;
  }
  
  // Default: no completion
  callback(null, [[], line]);
}

/**
 * Resolves directory contents for completion.
 * @param partial - The partial path string typed so far.
 */
async function path_complete(partial: string): Promise<string[]> {
  // 1. Handle ~ expansion for the partial path base
  let effectivePartial: string = partial;

  if (partial.startsWith('~')) {
    const home: string = (await backendInstalled_get()?.session.home_get()) ?? '/';
    if (partial === '~' || partial === '~/') {
      effectivePartial = home + (partial.endsWith('/') ? '/' : '');
    } else if (partial.startsWith('~/')) {
      effectivePartial = path.posix.join(home, partial.substring(2));
    }
  }

  // Resolve the directory to list and the prefix to match
  const { dirToList, prefix } = partialPath_split(effectivePartial);

  // 2. Resolve absolute path for listing
  let absDirToList: string;
  if (dirToList.startsWith('/')) {
    absDirToList = dirToList;
  } else {
    const cwd: string = await session.getCWD();
    absDirToList = dirToList ? path.posix.resolve(cwd, dirToList) : cwd;
  }

  // 3. Fetch contents (check cache first)
  let items: ListingItem[] = [];
  const listCache: ListingCache = listingCache_get();

  // Check cache first
  const cached = listCache.cache_get<ListingItem[]>(absDirToList);
  if (cached) {
    items = cached.data;
  } else {
    try {
      // The session's filesystem answers every path: the backend's mounts and fallback, and the core's.
      const vfsResult = await vfsDispatcher_get().list(absDirToList);
      if (vfsResult.ok) {
        items = listingItemsFromVfs_make(vfsResult.value);
      }

      // Names completed at the root even when its listing lacks them.
      if (absDirToList === '/' || absDirToList === '') {
        const hasItem = (name: string) => items.some((i: ListingItem) => i.name === name);
        for (const name of backendInstalled_get()?.completion?.rootWords ?? ['usr']) {
          if (!hasItem(name)) {
            items.push({ name, type: 'vfs', size: 0, owner: 'root', date: new Date().toISOString() });
          }
        }
      }

      // Cache the results
      if (items.length > 0) {
        listCache.cache_set(absDirToList, items);
      }
    } catch (e: unknown) {
      // Ignore errors (e.g., perms, not a dir)
    }
  }

  // 4. Filter and format matches, preserving the original partial's style
  // (tilde/relative) and appending "/" to directory-like entries.
  return completions_build(items, prefix, partial);
}

/**
 * Command words beyond the registry's, from the backend (ChRIS: its plugins).
 *
 * @returns The words, or none.
 */
async function commandWords_get(): Promise<string[]> {
  const words: (() => Promise<string[]>) | undefined = backendInstalled_get()?.completion?.commandWords;
  return words === undefined ? [] : await words();
}
