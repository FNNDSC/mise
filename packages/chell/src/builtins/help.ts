/**
 * @file Command help system.
 *
 * Provides help text for shell commands.
 *
 * @module
 */
import chalk from 'chalk';

interface CommandHelp {
  usage: string;
  description: string;
  options?: string[];
  examples?: string[];
}

const helpText: Record<string, CommandHelp> = {
  ls: {
    usage: 'ls [options] [path]',
    description: 'List directory contents',
    options: [
      '-l          Long format (detailed information, shows feed/plugin titles)',
      '-h          Human-readable sizes (use with -l)',
      '-f, --refresh  Force refresh (ignore cache)',
      '-r, --reverse  Reverse sort order',
      '-d          List directory itself, not contents',
      '--sort=<field>  Sort by: name, size, date, owner',
    ],
    examples: [
      'ls                    # List current directory',
      'ls -l                 # Long format with titles',
      'ls -lh                # Long format with human sizes',
      'ls -f                 # Force refresh from server',
      'ls /home/user/data    # List specific directory',
      'ls *.txt              # List matching files (wildcard)',
      'ls --sort=size -r     # Sort by size, reversed',
      '',
      '# Long format shows feed and plugin instance titles:',
      '# d user 0  2025-05-18  feed_875           Brain MRI Analysis',
      '# d user 0  2025-05-18  pl-dircopy_33314   pl-dircopy v2.1.2',
    ],
  },
  cd: {
    usage: 'cd [path]',
    description: 'Change current working directory',
    examples: [
      'cd /home/user/data    # Absolute path',
      'cd experiments        # Relative path',
      'cd ..                 # Parent directory',
      'cd ~                  # Home directory',
      'cd                    # Show current directory',
    ],
  },
  pwd: {
    usage: 'pwd [options]',
    description: 'Print current working directory',
    options: [
      '--title    Replace feed_XXXX and pl-<name>_XXXX with titles in path',
    ],
    examples: [
      'pwd                  # Show actual path',
      'pwd --title          # Show path with feed/plugin titles',
      '',
      '# Example output:',
      '# pwd',
      '# /home/chris/feeds/feed_2326/pl-dircopy_176660/data',
      '',
      '# pwd --title',
      '# /home/chris/feeds/Brain MRI Analysis/dircopy v2.1.1/data',
    ],
  },
  cat: {
    usage: 'cat <file> [file...]',
    description: 'Display file contents',
    examples: [
      'cat file.txt          # Display single file',
      'cat file1 file2       # Display multiple files',
      'cat *.log             # Display all .log files (wildcard)',
    ],
  },
  rm: {
    usage: 'rm [options] <path> [path...]',
    description: 'Remove files or directories',
    options: [
      '-r, -R      Remove directories recursively',
      '-f          Force removal',
      '-i          Prompt before every removal (interactive)',
      '-rf, -fr    Recursive and force combined',
      '-ri, -ir    Recursive and interactive combined',
      '--          End of options (treat remaining args as filenames)',
    ],
    examples: [
      'rm file.txt           # Remove single file',
      'rm file1 file2        # Remove multiple files',
      'rm *.json             # Remove all .json files (wildcard)',
      'rm -i *.log           # Prompt before removing each .log file',
      'rm -r directory/      # Remove directory recursively',
      'rm -rf temp_*         # Force remove all temp_* dirs',
      'rm -- --weird-name    # Remove file starting with --',
      'rm -- -dash-file      # Remove file starting with -',
    ],
  },
  cp: {
    usage: 'cp [options] <source...> <dest>',
    description: 'Copy files or directories (supports wildcards and multiple sources)',
    options: [
      '-r, --recursive    Recursive copy (for directories)',
    ],
    examples: [
      'cp file.txt copy.txt              # Copy single file',
      'cp -r dir1/ dir2/                 # Copy directory recursively',
      'cp file1 file2 file3 dest/        # Copy multiple files',
      'cp uploads/*.txt backup/          # Copy with wildcard',
      'cp "file with spaces.txt" dest/   # Use quotes for spaces',
    ],
  },
  mv: {
    usage: 'mv <source...> <dest>',
    description: 'Move or rename files or directories (supports wildcards and multiple sources)',
    examples: [
      'mv old.txt new.txt                # Rename file',
      'mv dir1/ dir2/                    # Move directory into dir2',
      'mv file.txt /home/user/archive/   # Move into existing directory',
      'mv file1 file2 file3 dest/        # Move multiple files',
      'mv uploads/* backup/              # Move with wildcard',
      'mv "file with spaces.txt" dest/   # Use quotes for spaces',
    ],
  },
  touch: {
    usage: 'touch [options] <file>',
    description: 'Create empty files or files with content',
    options: [
      '--withContents <string>          Create file with inline string content',
      '--withContentsFromFile <file>    Create file with content from local host file',
    ],
    examples: [
      'touch file.txt                                   # Create empty file',
      'touch --withContents "Hello!" greeting.txt       # Create file with string',
      'touch --withContentsFromFile template.json config.json  # Create from local file',
    ],
  },
  mkdir: {
    usage: 'mkdir <directory> [directory...]',
    description: 'Create directories',
    examples: [
      'mkdir newdir          # Create single directory',
      'mkdir dir1 dir2       # Create multiple directories',
      'mkdir experiments/run1  # Create nested directory',
    ],
  },
  upload: {
    usage: 'upload <local_path> <chris_path>',
    description: 'Upload files from local filesystem to ChRIS with progress tracking',
    options: [
      'Displays progress bar showing:',
      '  - File count and percentage complete',
      '  - Estimated time remaining (ETA)',
      '  - Data transfer progress',
      'Shows summary statistics after upload',
    ],
    examples: [
      'upload ~/data/file.csv /home/user/uploads/',
      'upload ./results/ ~/data/',
      'upload ~/experiment/data /home/user/projects/',
    ],
  },
  connect: {
    usage: 'connect <username> <url> [password]',
    description: 'Connect to ChRIS server',
    examples: [
      'connect alice https://cube.chrisproject.org/api/v1/',
      'connect bob http://localhost:8000/api/v1/ mypassword',
    ],
  },
  logout: {
    usage: 'logout',
    description: 'Disconnect from ChRIS server',
    examples: ['logout'],
  },
  plugin: {
    usage: 'plugin <subcommand> [options]',
    description: 'Work with a single ChRIS plugin - run, search, view documentation',
    options: [
      '',
      'DESCRIPTION:',
      '  Plugins are computational units in ChRIS that process data. The "plugin"',
      '  command operates on individual plugins - running them, searching for specific',
      '  plugins, or viewing their documentation.',
      '',
      'SUBCOMMANDS:',
      '  run <searchable> [params]    Execute a plugin instance with parameters',
      '  search <searchable>          Resolve a searchable to plugin IDs',
      '  readme <pluginId>            Display plugin README documentation',
      '',
      'SEARCHABLE FORMATS:',
      '  Simple:     pl-dircopy',
      '  Compound:   name:pl-dircopy,version:1.3.2',
      '  ID-based:   id:42',
      '  Batch:      id:77++id:33  (multiple plugins)',
      '',
      'PLUGIN RUN PARAMETERS:',
      '  Plugin-specific parameters use CLI flag format:',
      '    --param value              Single parameter',
      '    --flag                     Boolean flag',
      '    --param1 val1 --param2 val2   Multiple parameters',
      '',
      '  Run "parametersofplugin <name>" to see available parameters for a plugin.',
    ],
    examples: [
      '# Search for plugins',
      'plugin search pl-dircopy',
      'plugin search name:dcm2niix',
      'plugin search id:42',
      '',
      '# View plugin documentation',
      'plugin readme 42',
      'plugin readme pl-dircopy',
      '',
      '# Run a plugin (simple)',
      'plugin run pl-dircopy',
      '',
      '# Run plugin with parameters',
      'plugin run pl-dircopy --dir /incoming',
      'plugin run name:pl-dcm2niix,version:1.0.2 --outputdir /results',
      '',
      '# Run with multiple parameters',
      'plugin run pl-segmentation --threshold 0.5 --method watershed',
      '',
      '# Run with specific version',
      'plugin run name:pl-dircopy,version:2.1.1 --dir /data',
    ],
  },
  plugins: {
    usage: 'plugins <subcommand> [options]',
    description: 'Manage collections of ChRIS plugins - list, add, delete, query',
    options: [
      '',
      'DESCRIPTION:',
      '  Plugins are computational units in ChRIS. The "plugins" command operates on',
      '  collections of plugins - listing all available plugins, adding new plugins to',
      '  ChRIS, deleting plugins, or querying plugin metadata.',
      '',
      'SUBCOMMANDS:',
      '  list              List all plugins',
      '  fieldslist        List available plugin fields',
      '  delete <id>       Remove a plugin from ChRIS',
      '  overview          Show plugin system overview',
      '  add <input>       Register a new plugin to ChRIS',
      '',
      'PLUGINS ADD OPTIONS:',
      '  --compute <resources>         Comma-separated compute resources (default: host)',
      '  --store <url>                 Peer store URL (default: cube.chrisproject.org)',
      '  --adminUser <username>        Admin username (to skip interactive prompt)',
      '  --adminPassword <password>    Admin password (to skip interactive prompt)',
      '  --publicRepo <url>            Public repository URL for the plugin',
      '',
      'PLUGIN INPUT FORMATS:',
      '  Plugin name:      pl-dircopy',
      '  Docker image:     fnndsc/pl-dircopy:2.1.1',
      '  Store URL:        https://cube.chrisproject.org/api/v1/plugins/96/',
    ],
    examples: [
      '# List all plugins',
      'plugins list',
      'plugins list --search name:dircopy',
      'plugins list --fields name,version,dock_image',
      '',
      '# List available fields',
      'plugins fieldslist',
      '',
      '# Delete a plugin',
      'plugins delete 42',
      '',
      '# Show plugin system overview',
      'plugins overview',
      '',
      '# Add plugin from peer store (searches cube.chrisproject.org)',
      'plugins add pl-dircopy',
      'plugins add pl-dircopy --compute host,gpu',
      '',
      '# Add plugin with admin credentials (skip prompt)',
      'plugins add pl-dircopy --adminUser chris --adminPassword chris1234',
      '',
      '# Add plugin from Docker image',
      'plugins add fnndsc/pl-dircopy:2.1.1',
      'plugins add fnndsc/pl-dircopy:2.1.1 --compute host',
      '',
      '# Add plugin from custom peer store',
      'plugins add pl-custom --store https://my-cube.org/api/v1/',
      '',
      '# Add plugin with specific repository',
      'plugins add my-plugin:latest --publicRepo https://github.com/org/my-plugin',
    ],
  },
  feed: {
    usage: 'feed <subcommand> [options]',
    description: 'Work with a single ChRIS feed - create new feeds',
    options: [
      '',
      'DESCRIPTION:',
      '  A feed represents a data analysis workflow in ChRIS - a directed acyclic graph',
      '  (DAG) of plugin executions. The "feed" command operates on individual feeds,',
      '  primarily creating new feeds from data directories.',
      '',
      'SUBCOMMANDS:',
      '  create <path>     Create a new feed from a data directory',
    ],
    examples: [
      '# Create a new feed from upload directory',
      'feed create /home/user/uploads/MRI-data',
      '',
      '# Create feed with custom title',
      'feed create /home/user/uploads/experiment-1 --title "Experiment 1"',
    ],
  },
  feeds: {
    usage: 'feeds <subcommand> [options]',
    description: 'Manage collections of ChRIS feeds - list, delete, share, query',
    options: [
      '',
      'DESCRIPTION:',
      '  A feed represents a data analysis workflow in ChRIS. The "feeds" command',
      '  operates on collections of feeds - listing all feeds, deleting feeds, sharing',
      '  feeds with collaborators, or querying feed metadata.',
      '',
      'SUBCOMMANDS:',
      '  list              List all feeds',
      '  fieldslist        List available feed fields',
      '  delete <id>       Remove a feed',
      '  share <id>        Share a feed with other users',
    ],
    examples: [
      '# List all feeds',
      'feeds list',
      'feeds list --search name:experiment',
      'feeds list --fields id,name,creation_date',
      '',
      '# List available fields',
      'feeds fieldslist',
      '',
      '# Delete a feed',
      'feeds delete 123',
      '',
      '# Share a feed',
      'feeds share 123',
    ],
  },
  files: {
    usage: 'files <subcommand> [path] [options]',
    description: 'Manage file resources',
    examples: [
      'files list            # List all files',
      'files list /path      # List files in path',
      'files fieldslist      # List available fields',
    ],
  },
  links: {
    usage: 'links <subcommand> [path] [options]',
    description: 'Manage link resources',
    examples: ['links list', 'links fieldslist'],
  },
  dirs: {
    usage: 'dirs <subcommand> [path] [options]',
    description: 'Manage directory resources',
    examples: ['dirs list', 'dirs fieldslist'],
  },
  chefs: {
    usage: 'chefs <subcommand> [args]',
    description: 'ChRIS Experimental File System commands',
    examples: [
      'chefs ls -l                                         # List directory',
      'chefs mkdir newdir                                  # Create directory',
      'chefs touch file.txt                                # Create empty file',
      'chefs touch --withContents "data" file.txt          # Create file with content',
      'chefs touch --withContentsFromFile local.txt remote.txt  # Create from local file',
      'chefs rm file                                       # Remove file',
    ],
  },
  exit: {
    usage: 'exit',
    description: 'Exit the shell',
    examples: ['exit'],
  },
  context: {
    usage: 'context',
    description: 'Display current ChRIS context information',
    examples: ['context'],
  },
  physicalmode: {
    usage: 'physicalmode [on|off]',
    description: 'Toggle or display physical filesystem mode',
    options: [
      'on          Enable physical mode (paths used directly)',
      'off         Disable physical mode (use logical-to-physical mapping)',
    ],
    examples: [
      'physicalmode          # Show current status',
      'physicalmode on       # Enable physical mode',
      'physicalmode off      # Disable physical mode',
    ],
  },
  timing: {
    usage: 'timing [on|off]',
    description: 'Toggle or display command timing mode',
    options: [
      'on          Enable timing display',
      'off         Disable timing display',
    ],
    examples: [
      'timing                # Show current status',
      'timing on             # Enable timing display',
      'timing off            # Disable timing display',
    ],
  },
  debug: {
    usage: 'debug [on|off]',
    description: 'Toggle or display debug mode (verbose logging)',
    options: [
      'on          Enable debug logging',
      'off         Disable debug logging',
    ],
    examples: [
      'debug                 # Show current status',
      'debug on              # Enable debug mode',
      'debug off             # Disable debug mode',
    ],
  },
  parametersofplugin: {
    usage: 'parametersofplugin <plugin_name>',
    description: 'Display parameters for a specific plugin',
    examples: [
      'parametersofplugin pl-dircopy',
      'parametersofplugin pl-simpledsapp',
    ],
  },
  tree: {
    usage: 'tree [options] [path]',
    description: 'Display directory tree structure',
    options: [
      '--follow    Follow symbolic links when traversing',
    ],
    examples: [
      'tree                  # Tree of current directory',
      'tree /home/user/data  # Tree of specific path',
      'tree --follow         # Follow symbolic links',
    ],
  },
  du: {
    usage: 'du [options] [path]',
    description: 'Display disk usage statistics (mimics Linux du)',
    options: [
      '-h, --human-readable  Print sizes in human readable format',
      '-s, --summarize       Display only total for each argument',
      '-a, --all             Show counts for all files, not just directories',
      '-c, --total           Produce a grand total',
      '-d N, --max-depth=N   Print total only if N or fewer levels below',
      '-S, --separate-dirs   Do not include size of subdirectories',
    ],
    examples: [
      'du                    # Disk usage of current directory',
      'du -h                 # Human-readable sizes (1K, 234M, 2G)',
      'du -s /home/user/data # Summary only for specified path',
      'du -a                 # Show all files, not just directories',
      'du -c                 # Show grand total at end',
      'du -d 2               # Max depth of 2 levels',
      'du -sh                # Human-readable summary',
    ],
  },
  store: {
    usage: 'store <subcommand> [options]',
    description: 'Browse and search the ChRIS peer store',
    options: [
      '--store <url>         Use specific store URL',
      '-l                    Long listing format',
    ],
    examples: [
      'store list            # List all plugins in store',
      'store search dicom    # Search plugins matching "dicom"',
      'store list -l         # List with details',
    ],
  },
  help: {
    usage: 'help [command]',
    description: 'Display help information',
    examples: [
      'help                  # List all commands',
      'help ls               # Show help for ls',
      'help timing           # Show help for timing',
    ],
  },
  '!': {
    usage: '! <shell_command>',
    description: 'Execute command on host shell (shell escape)',
    examples: [
      '! ls                  # List files on host system',
      '! pwd                 # Print host working directory',
      '! cat /etc/hostname   # Read host file',
      '! df -h               # Check host disk usage',
      '! echo "test" > /tmp/file.txt  # Write to host file',
    ],
  },
};

/**
 * Displays help text for a command.
 *
 * @param command - The command to display help for.
 */
export function help_show(command: string): void {
  const help: CommandHelp | undefined = helpText[command];

  if (!help) {
    console.log(chalk.yellow(`No help available for '${command}'`));
    console.log(chalk.gray('Type "help" to see all available commands.'));
    return;
  }

  console.log('');
  console.log(chalk.bold.magenta(command.toUpperCase()));
  console.log(chalk.gray('─'.repeat(60)));
  console.log('');
  
  console.log(chalk.bold.blue('USAGE'));
  const usageParts = help.usage.split(' ');
  const cmdName = usageParts[0];
  const args = usageParts.slice(1).join(' ');
  console.log(`  ${chalk.green(cmdName)} ${chalk.cyan(args)}`);
  
  console.log('');
  console.log(chalk.bold.blue('DESCRIPTION'));
  console.log(`  ${help.description}`);

  if (help.options && help.options.length > 0) {
    console.log('');
    console.log(chalk.bold.blue('OPTIONS'));
    help.options.forEach((opt: string) => {
      const trimmed = opt.trim();
      if (!trimmed) {
        console.log('');
        return;
      }
      
      // Check if it's a header (ends with :)
      if (trimmed.endsWith(':')) {
        console.log(`  ${chalk.bold.white(trimmed)}`);
        return;
      }

      // Try to split by double space (common separator in help definitions)
      // Regex: Start, (indent), (content), (2+ spaces), (rest)
      const splitMatch = opt.match(/^(\s*)(.*?)(\s{2,})(.*)$/);
      
      if (splitMatch) {
        const [, indent, content, separator, description] = splitMatch;
        console.log(`  ${indent}${chalk.yellow(content)}${separator}${description}`);
      } else {
        // Fallback: check if it starts with - (simple flag without aligned description)
        if (trimmed.startsWith('-')) {
             console.log(`  ${chalk.yellow(opt)}`);
        } else {
             console.log(`  ${opt}`);
        }
      }
    });
  }

  if (help.examples && help.examples.length > 0) {
    console.log('');
    console.log(chalk.bold.blue('EXAMPLES'));
    help.examples.forEach((ex: string) => {
      const commentIdx = ex.indexOf('#');
      if (commentIdx !== -1) {
        const cmdPart = ex.substring(0, commentIdx);
        const commentPart = ex.substring(commentIdx);
        console.log(`  ${chalk.white(cmdPart)}${chalk.gray(commentPart)}`);
      } else {
        console.log(`  ${chalk.white(ex)}`);
      }
    });
  }

  console.log('');
}

/**
 * Checks if arguments contain --help flag.
 * -h is treated as help unless the command uses it for "human-readable" (ls, du).
 *
 * @param args - Command arguments.
 * @param command - The command name (optional).
 * @returns True if help is requested.
 */
export function hasHelpFlag(args: string[], command?: string): boolean {
  if (args.includes('--help')) return true;

  // Commands where -h means human-readable sizes, not help
  const humanReadableCommands = ['ls', 'du'];
  
  if (command && humanReadableCommands.includes(command)) {
    return false;
  }
  
  return args.includes('-h');
}

/**
 * Builtin help command - displays command list or specific command help.
 *
 * @param args - Command arguments (optional command name).
 */
export async function builtin_help(args: string[]): Promise<void> {
  const commandName: string | undefined = args[0];

  // If a specific command is requested, show its help
  if (commandName) {
    help_show(commandName);
    return;
  }

  // Otherwise, list all available commands
  console.log('');
  console.log(chalk.bold.cyan('ChELL - Available Commands'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log('');

  // Group commands by category
  const categories: Record<string, string[]> = {
    Navigation: ['cd', 'pwd', 'ls', 'tree', 'du'],
    'File Operations': ['cat', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'upload', 'chefs'],
    Connection: ['connect', 'logout', 'context'],
    'Single Resource': ['plugin', 'feed'],
    'Resource Collections': ['plugins', 'feeds', 'files', 'links', 'dirs', 'store', 'parametersofplugin'],
    'Shell Settings': ['physicalmode', 'timing', 'debug'],
    General: ['help', 'exit', '!'],
  };

  // Display commands by category
  for (const [category, commands] of Object.entries(categories)) {
    console.log(chalk.bold.yellow(category));
    commands.forEach((cmd: string) => {
      const help: CommandHelp | undefined = helpText[cmd];
      if (help) {
        console.log(`  ${chalk.cyan(cmd.padEnd(20))} ${chalk.gray(help.description)}`);
      }
    });
    console.log('');
  }

  console.log(chalk.gray('Type "help <command>" for detailed information about a command.'));
  console.log(chalk.gray('Type "<command> --help" for quick help on any command.'));
  console.log('');
}

/**
 * Gets the list of all builtin command names.
 *
 * @returns Array of builtin command names.
 */
export function builtinCommands_list(): string[] {
  return Object.keys(helpText);
}

/**
 * Gets the description for a builtin command.
 *
 * @param command - The command name.
 * @returns The command description, or undefined if not found.
 */
export function builtinCommand_description(command: string): string | undefined {
  return helpText[command]?.description;
}
