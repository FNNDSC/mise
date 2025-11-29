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
    ],
    examples: [
      'ls                    # List current directory',
      'ls -l                 # Long format',
      'ls -lh                # Long format with human sizes',
      'ls /home/user/data    # List specific directory',
      'ls *.txt              # List matching files (wildcard)',
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
    ],
    examples: [
      'rm file.txt           # Remove single file',
      'rm file1 file2        # Remove multiple files',
      'rm *.json             # Remove all .json files (wildcard)',
      'rm -i *.log           # Prompt before removing each .log file',
      'rm -r directory/      # Remove directory recursively',
      'rm -rf temp_*         # Force remove all temp_* dirs',
    ],
  },
  upload: {
    usage: 'upload <local_path> <chris_path>',
    description: 'Upload files from local filesystem to ChRIS',
    examples: [
      'upload ~/data/file.csv /home/user/uploads/',
      'upload ./results/ ~/data/',
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
      'chefs ls -l           # List directory',
      'chefs mkdir newdir    # Create directory',
      'chefs touch file.txt  # Create empty file',
      'chefs rm file         # Remove file',
    ],
  },
  exit: {
    usage: 'exit',
    description: 'Exit the shell',
    examples: ['exit'],
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
    console.log(chalk.gray('Try: connect, ls, cd, pwd, cat, rm, upload, plugin, feed, files, links, dirs, exit'));
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
