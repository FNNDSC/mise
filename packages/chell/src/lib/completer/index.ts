/**
 * @file REPL Autocompletion.
 *
 * Provides tab-completion logic for the REPL, including built-in commands
 * and path completion.
 *
 * @module
 */
import { session } from '../../session/index.js';
import { plugins_listAll } from '@fnndsc/salsa';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { files_list } from '@fnndsc/chili/commands/fs/ls.js';
import { context_getSingle } from '@fnndsc/salsa';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { listCache_get } from '@fnndsc/cumin';
import * as path from 'path';
import { builtinCommands_list } from '../../builtins/help.js';

/**
 * Callback function type for autocomplete results.
 * @param err - Error if completion failed, null otherwise.
 * @param result - Tuple of [matches array, original input string].
 */
type CompleterCallback = (err: Error | null, result: [string[], string]) => void;

const BUILTINS: string[] = [
  'cat',
  'cd',
  'chefs',
  'connect',
  'context',
  'cp',
  'mv',
  'debug',
  'dirs',
  'exit',
  'feed',
  'feeds',
  'files',
  'help',
  'links',
  'logout',
  'ls',
  'mkdir',
  'parametersofplugin',
  'physicalmode',
  'plugin',
  'plugins',
  'pwd',
  'quit',
  'rm',
  'timing',
  'touch',
  'tree',
  'du',
  'upload'
];

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
    const cached = listCache.cache_get('/bin');

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
export function completer(line: string, callback: CompleterCallback): void {
  const trimmed = line.trimStart();
  // Check if we are completing the first word (command) or subsequent args
  // A simple split by space might be enough for now, assuming no quoted args with spaces for MVP
  const args = trimmed.split(/\s+/);

  // Case 1: Command Completion (First word)
  // If we have only one token and the line doesn't end with space, we are typing the command
  // Or if line is empty
  const isCommandCompletion = args.length === 1 && !line.endsWith(' ');

  if (isCommandCompletion) {
    // Check builtins first (instant, no async)
    const builtinHits: string[] = BUILTINS.filter((c) => c.startsWith(trimmed));

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
  if (['cd', 'ls', 'mkdir', 'touch', 'cat', 'cp', 'mv', 'rm', 'upload', 'du', 'tree'].includes(cmd)) {
    // The partial path is the last argument being typed
    // If the line ends with space, we are starting a new argument (empty prefix)
    const partialPath = line.endsWith(' ') ? '' : args[args.length - 1];
    
    path_complete(partialPath).then((matches) => {
        callback(null, [matches, partialPath]);
    }).catch((err) => {
        // On error, return no matches, don't crash REPL
        callback(null, [[], partialPath]);
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
    const context = context_getSingle();
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

  if (absDirToList === '/bin') {
     // Virtual bin - plugins
     // Check cache first
     const cached = listCache.cache_get('/bin');
     let lsItems: ListingItem[] | undefined;

     if (cached) {
       lsItems = cached.data;
     } else {
       // Cache miss - fetch from API
       const plugins = await plugins_listAll({});
       if (plugins && plugins.tableData) {
         lsItems = plugins.tableData.map((p: Record<string, unknown>) => {
           const name = typeof p.name === 'string' ? p.name : String(p.name ?? '');
           const version = typeof p.version === 'string' ? p.version : String(p.version ?? '');
           return {
             name: version ? `${name}-v${version}` : name,
             type: 'plugin' as const,
             size: 0,
             owner: 'system',
             date: p.creation_date ? String(p.creation_date) : '',
           };
         });
         // Cache the results
         listCache.cache_set('/bin', lsItems);
       }
     }
     if (lsItems) {
       items = lsItems;
     }
  } else if (absDirToList === '/usr') {
     // Virtual /usr - contains 'bin' subdirectory
     items = [{
       name: 'bin',
       type: 'vfs',
       size: 0,
       owner: 'root',
       date: new Date().toISOString(),
     }];
  } else if (absDirToList === '/usr/bin') {
     // Virtual /usr/bin - builtin commands
     const builtinNames: string[] = builtinCommands_list();
     items = builtinNames.map((name: string) => ({
       name,
       type: 'file' as const,
       size: 0,
       owner: 'system',
       date: new Date().toISOString(),
     }));
  } else {
     // Native ChRIS
     try {
       // Check cache first
       const cached = listCache.cache_get(absDirToList);
       let lsItems: ListingItem[] | undefined;

       if (cached) {
         lsItems = cached.data;
       } else {
                // Cache miss - fetch from API
                lsItems = await files_list({} as CLIoptions, absDirToList);         if (lsItems) {
           // Inject virtual directories if at root
           if (absDirToList === '/') {
             lsItems.push({
               name: 'bin',
               type: 'vfs',
               size: 0,
               owner: 'root',
               date: new Date().toISOString(),
             });
             lsItems.push({
               name: 'usr',
               type: 'vfs',
               size: 0,
               owner: 'root',
               date: new Date().toISOString(),
             });
           }
           // Cache the results
           listCache.cache_set(absDirToList, lsItems);
         }
       }
       if (lsItems) {
         items = lsItems;
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
