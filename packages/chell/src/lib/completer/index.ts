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
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import * as path from 'path';

/**
 * Callback function type for autocomplete results.
 * @param err - Error if completion failed, null otherwise.
 * @param result - Tuple of [matches array, original input string].
 */
type CompleterCallback = (err: Error | null, result: [string[], string]) => void;

const BUILTINS: string[] = [
  'cd',
  'pwd',
  'ls',
  'connect',
  'logout',
  'chefs',
  'mkdir',
  'touch',
  'help',
  'exit',
  'quit'
];

/**
 * Fetches available plugin names from /bin.
 * @returns Array of plugin names.
 */
async function plugins_getNames(): Promise<string[]> {
  try {
    const plugins = await plugins_listAll({});
    if (plugins && plugins.tableData) {
      return plugins.tableData.map((p: Record<string, unknown>) => {
        return typeof p.name === 'string' ? p.name : String(p.name ?? '');
      });
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
    // Fetch plugin names and combine with builtins
    plugins_getNames().then((pluginNames) => {
      const allCommands = [...BUILTINS, ...pluginNames];
      const hits = allCommands.filter((c) => c.startsWith(trimmed));
      callback(null, [hits, trimmed]);
    }).catch(() => {
      // On error, fall back to just builtins
      const hits = BUILTINS.filter((c) => c.startsWith(trimmed));
      callback(null, [hits, trimmed]);
    });
    return;
  }
  
  // Case 2: Path Completion (Argument to specific commands)
  const cmd = args[0];
  if (['cd', 'ls', 'mkdir', 'touch', 'cat'].includes(cmd)) {
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
  /*
  if (partial.startsWith('~')) {
    const user = await session.connection.user_get();
    const home = user ? `/home/${user}` : '/';
    if (partial === '~' || partial === '~/') {
      effectivePartial = home + (partial.endsWith('/') ? '/' : '');
    } else if (partial.startsWith('~/')) {
      effectivePartial = path.posix.join(home, partial.substring(2));
    }
  }
  */

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

  // 3. Fetch contents
  let items: string[] = [];
  
  if (absDirToList === '/bin') {
     // Virtual bin - plugins
     const plugins = await plugins_listAll({});
     if (plugins && plugins.tableData) {
       items = plugins.tableData.map((p: Record<string, unknown>) => {
         return typeof p.name === 'string' ? p.name : String(p.name ?? '');
       });
     }
  } else {
     // Native ChRIS
     try {
       const lsItems: ListingItem[] | null = await files_list({} as CLIoptions, absDirToList);
       if (lsItems) {
           items = lsItems.map((i: ListingItem) => i.name);
       }
       
       // Inject 'bin' if at root
       if (absDirToList === '/') {
         items.push('bin');
       }
     } catch (e) {
       // Ignore errors (e.g., perms, not a dir)
     }
  }
  
  // 4. Filter and format matches
  const matches = items.filter(i => i.startsWith(prefix));
  
  // Prepend the directory part from the *original* partial input to preserve user's input style (relative/absolute/tilde)
  // If partial was '~/doc', dirPart is '~/'. Match 'docs' -> '~/docs'
  // If partial was 'foo', dirPart is ''. Match 'foobar' -> 'foobar'
  const dirPart = partial.endsWith('/') ? partial : (partial.includes('/') ? partial.substring(0, partial.lastIndexOf('/') + 1) : '');
  
  // Add trailing slash for directories? 
  // Ideally yes, but we don't easily know which are directories without checking types.
  // For now, just return names.
  
  return matches.map(m => dirPart + m);
}
