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
      '-l          Long format (detailed information)',
      '-h          Human-readable sizes (use with -l)',
      '-f, --refresh  Force refresh (ignore cache)',
      '-r, --reverse  Reverse sort order',
      '-d          List directory itself, not contents',
      '--sort=<field>  Sort by: name, size, date, owner',
    ],
    examples: [
      'ls                    # List current directory',
      'ls -l                 # Long format',
      'ls -lh                # Long format with human sizes',
      'ls -f                 # Force refresh from server',
      'ls /home/user/data    # List specific directory',
      'ls *.txt              # List matching files (wildcard)',
      'ls --sort=size -r     # Sort by size, reversed',
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
    usage: 'pwd',
    description: 'Print current working directory',
    examples: ['pwd'],
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
    description: 'Manage ChRIS plugins',
    examples: [
      'plugin list           # List all plugins',
      'plugin fieldslist     # List available fields',
      'plugin run pl-name    # Execute plugin (delegated)',
    ],
  },
  plugins: {
    usage: 'plugins <subcommand> [options]',
    description: 'Manage ChRIS plugins (alias for plugin)',
    examples: [
      'plugins list --search name:dircopy',
      'plugins list --fields name,version',
    ],
  },
  feed: {
    usage: 'feed <subcommand> [options]',
    description: 'Manage ChRIS feeds',
    examples: [
      'feed list             # List all feeds',
      'feed fieldslist       # List available fields',
    ],
  },
  feeds: {
    usage: 'feeds <subcommand> [options]',
    description: 'Manage ChRIS feeds (alias for feed)',
    examples: ['feeds list --search name:experiment'],
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
  console.log(chalk.bold.cyan(command.toUpperCase()));
  console.log(chalk.gray('─'.repeat(60)));
  console.log('');
  console.log(chalk.bold('USAGE'));
  console.log(`  ${help.usage}`);
  console.log('');
  console.log(chalk.bold('DESCRIPTION'));
  console.log(`  ${help.description}`);

  if (help.options && help.options.length > 0) {
    console.log('');
    console.log(chalk.bold('OPTIONS'));
    help.options.forEach((opt: string) => {
      console.log(`  ${opt}`);
    });
  }

  if (help.examples && help.examples.length > 0) {
    console.log('');
    console.log(chalk.bold('EXAMPLES'));
    help.examples.forEach((ex: string) => {
      console.log(`  ${ex}`);
    });
  }

  console.log('');
}

/**
 * Checks if arguments contain --help flag.
 *
 * @param args - Command arguments.
 * @returns True if --help is present.
 */
export function hasHelpFlag(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
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
    Resources: ['plugin', 'plugins', 'feed', 'feeds', 'files', 'links', 'dirs', 'parametersofplugin'],
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
