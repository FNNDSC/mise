/**
 * @file REPL Autocompletion.
 *
 * Provides tab-completion logic for the REPL, including built-in commands
 * and path completion.
 *
 * @module
 */
import { session } from '../../session/index.js';
import { plugins_listAll, vfsDispatcher, context_getSingle } from '@fnndsc/salsa';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { listCache_get } from '@fnndsc/cumin';
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
 * Fetches available plugin names from /bin in the format: name-vVersion.
 * This matches the display format used in /bin listings.
 * Uses cache first for fast completion.
 * @returns Array of plugin names with version suffixes.
 */
async function plugins_getNames(): Promise<string[]> {
  try {
    // Check cache first for /bin
    const listCache = listCache_get();
    const cached = listCache.cache_get<ListingItem[]>('/bin');

    if (cached && cached.data) {
      // Return cached plugin names immediately
      return cached.data.map((item: ListingItem) => item.name);
    }

    // Cache miss - fetch from API (only on first tab completion)
    const plugins = await plugins_listAll({});
    if (plugins && plugins.tableData) {
      const pluginNames: string[] = plugins.tableData.map((p: Record<string, unknown>) => {
        const name: string = typeof p.name === 'string' ? p.name : String(p.name ?? '');
        const version: string = typeof p.version === 'string' ? p.version : String(p.version ?? '');
        // Format as name-vVersion to match /bin display format
        return version ? `${name}-v${version}` : name;
      });

      // Cache it for next time
      const lsItems: ListingItem[] = plugins.tableData.map((p: Record<string, unknown>) => {
        const name: string = typeof p.name === 'string' ? p.name : String(p.name ?? '');
        const version: string = typeof p.version === 'string' ? p.version : String(p.version ?? '');
        return {
          name: version ? `${name}-v${version}` : name,
          type: 'plugin' as const,
          size: 0,
          owner: 'system',
          date: p.creation_date ? String(p.creation_date) : '',
        };
      });
      listCache.cache_set('/bin', lsItems);

      return pluginNames;
    }
  } catch (e) {
    // Silently fail if plugins cannot be fetched
  }
  return [];
}

/**
 * Computes autocomplete suggestions for a given input line.
 * Uses the callback style to support asynchronous operations (fetching files).
 *
 * @param line - The current input line.
 * @param callback - The callback function to return results.
 */
export function input_complete(line: string, callback: CompleterCallback): void {
  const trimmed = line.trimStart();
  const args: string[] = args_tokenize(trimmed);

  // Case 1: Command Completion (First word)
  // If we have only one token and the line doesn't end with space, we are typing the command
  // Or if line is empty
  const isCommandCompletion = args.length === 0 || (args.length === 1 && !line.endsWith(' '));

  if (isCommandCompletion) {
    // Check builtins first (instant, no async)
    const builtinHits: string[] = builtinCommands_list().filter((c: string) => c.startsWith(trimmed));

    // Always check plugins and combine results
    plugins_getNames().then((pluginNames) => {
      const pluginHits: string[] = pluginNames.filter((c) => c.startsWith(trimmed));
      
      // Combine both builtins and plugins
      const allHits = [...builtinHits, ...pluginHits];
      callback(null, [allHits, trimmed]);
    }).catch(() => {
      // On error, return only builtin matches
      callback(null, [builtinHits, trimmed]);
    });
    return;
  }
  
  // Case 2: Path Completion (Argument to specific commands)
  const cmd = args[0];
  if (['cd', 'ls', 'mkdir', 'touch', 'cat', 'cp', 'mv', 'rm', 'upload', 'download', 'du', 'tree', 'pull', 'cubepath', 'query'].includes(cmd)) {
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
  // 1. Resolve the directory to list and the prefix to match
  let dirToList: string;
  let prefix: string;
  
  // Handle ~ expansion for the partial path base
  let effectivePartial = partial;
  
  if (partial.startsWith('~')) {
    const context = await context_getSingle();
    const user: string | null = context.user;
    const home = user ? `/home/${user}` : '/';
    if (partial === '~' || partial === '~/') {
      effectivePartial = home + (partial.endsWith('/') ? '/' : '');
    } else if (partial.startsWith('~/')) {
      effectivePartial = path.posix.join(home, partial.substring(2));
    }
  }

  if (effectivePartial.endsWith('/')) {
     dirToList = effectivePartial;
     prefix = '';
  } else {
     dirToList = path.posix.dirname(effectivePartial);
     prefix = path.posix.basename(effectivePartial);
     if (dirToList === '.') dirToList = ''; // Relative current dir
  }

  // 2. Resolve absolute path for listing
  let absDirToList: string;
  if (dirToList.startsWith('/')) {
    absDirToList = dirToList;
  } else {
    const cwd = await session.getCWD();
    absDirToList = dirToList ? path.posix.resolve(cwd, dirToList) : cwd;
  }

  // 3. Fetch contents (check cache first)
  let items: ListingItem[] = [];
  const listCache = listCache_get();

  // Check cache first
  const cached = listCache.cache_get<ListingItem[]>(absDirToList);
  if (cached) {
    items = cached.data;
  } else {
    try {
      // Use vfsDispatcher for all path types — handles /pacs, /bin, native, etc.
      const vfsResult = await vfsDispatcher.list(absDirToList);
      if (vfsResult.ok) {
        items = vfsResult.value as unknown as ListingItem[];
      }

      // Inject virtual directories at root if missing
      if (absDirToList === '/' || absDirToList === '') {
        const hasItem = (name: string) => items.some((i: ListingItem) => i.name === name);
        if (!hasItem('bin')) {
          items.push({ name: 'bin', type: 'vfs', size: 0, owner: 'root', date: new Date().toISOString() });
        }
        if (!hasItem('usr')) {
          items.push({ name: 'usr', type: 'vfs', size: 0, owner: 'root', date: new Date().toISOString() });
        }
        if (!hasItem('pacs')) {
          items.push({ name: 'pacs', type: 'vfs', size: 0, owner: 'root', date: new Date().toISOString() });
        }
      }

      // Cache the results
      if (items.length > 0) {
        listCache.cache_set(absDirToList, items);
      }
    } catch (e) {
      // Ignore errors (e.g., perms, not a dir)
    }
  }

  // 4. Filter and format matches
  const hits: ListingItem[] = items.filter((i: ListingItem) => i.name.startsWith(prefix));

  // Reconstruct the full path for each match, preserving the original partial's style (tilde/relative)
  // Append "/" for directories and virtual filesystems
  const completions: string[] = hits.map((hit: ListingItem) => {
    // This is the segment that was *not* yet typed, but matched.
    // Example: partial = "~/P", prefix = "P", hit.name = "PIPELINES", remainingSegment = "IPELINES"
    // Example: partial = "~/", prefix = "", hit.name = "home", remainingSegment = "home"
    const remainingSegment: string = hit.name.substring(prefix.length);

    // We want to return the original partial + remainingSegment
    // Example: "~/P" + "IPELINES" = "~/PIPELINES"
    // Example: "~/" + "home" = "~/home"
    // Example: "fo" + "obar" = "foobar"
    let completion: string = partial + remainingSegment;

    // Append "/" for directories, virtual filesystems, and links (which may point to directories)
    if (hit.type === 'dir' || hit.type === 'vfs' || hit.type === 'link') {
      completion += '/';
    }

    return completion;
  });

  return completions;
}
