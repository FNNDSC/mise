/**
 * @file Command help system.
 *
 * Provides help text for shell commands.
 *
 * @module
 */
import { gamesShelf_render, gamesShelf_names } from './games/shelf.js';
import chalk from 'chalk';
import { CAT_USAGE } from './fs/cat.args.js';
import { commands_register, commandHelpEntry_get, helpTopic_names, builtinCommand_has, type CommandHelp } from '../core/commandRegistry.js';
import { backendInstalled_get } from '../core/backend.js';
import type { CommandEnvelope } from '@fnndsc/menu';


/**
 * Help-text registry keyed by builtin command name.
 */
export const helpText: Record<string, CommandHelp> = {
  sudo: {
    usage: 'sudo <command> [arguments...]',
    description: 'Run one ChRIS command with a temporary administrator identity',
    options: [
      'Prompts for an administrator username and hidden password on the active surface.',
      'The elevated CUBE token is used only for the nested command; it is not saved or made the session identity.',
    ],
    examples: [
      'sudo group adduser pacs_users peter.hong',
      'sudo plugin add pl-dircopy',
    ],
  },
  ls: {
    usage: 'ls [options] [path]',
    description: 'List directory contents',
    options: [
      '-l          Long format (detailed information, shows feed/plugin titles)',
      '-1          One entry per line (single-column)',
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
    usage: CAT_USAGE,
    description: 'Display file contents, with terminal syntax highlighting for recognized text formats',
    options: [
      '--binary              Force byte-for-byte binary output',
      '--highlight           Force highlighting; infer the language from the filename or content',
      '--highlight=LANGUAGE  Force a cli-highlight language such as python, typescript, or sql',
      '--no-highlight        Disable automatic syntax highlighting',
    ],
    examples: [
      'cat file.txt                    # Display single file',
      'cat analysis.py                 # Auto-highlight Python in a terminal',
      'cat source --highlight=python   # Force Python highlighting without filename inference',
      'cat config.json --no-highlight  # Display raw text',
      'cat file1 file2                 # Display multiple files',
    ],
  },
  rm: {
    usage: 'rm [options] <path> [path...]',
    description: 'Remove files or directories',
    options: [
      '-r, -R, --recursive  Remove directories recursively (without it a directory is "Is a directory")',
      '-f, --force          Force removal',
      '-i, --interactive    Prompt before every removal (interactive)',
      '-I          Prompt ONCE for the whole list, naming how many',
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
    usage: 'cp [-t <dir>] [options] <source...> [dest]',
    description: 'Copy files or directories (supports wildcards and multiple sources)',
    options: [
      '(given only a source, the destination is asked for)',
      '-t <dir>    Target DIRECTORY; every operand is a source. Given no',
      '            value it asks where, and the answer must be a directory.',
      '-r, --recursive    Recursive copy (for directories)',
      '',
      'PACS SOURCES: a /net/pacs/queries/... source names query results, not',
      'stored files. cp MATERIALIZES the series: if its DICOMs are not yet in',
      'CUBE it fires a PACS retrieve and waits for them to land (the same',
      'engine as pull), then copies the landed files to the destination.',
      'A series already fully in CUBE is copied without a retrieve.',
    ],
    examples: [
      'cp file.txt copy.txt              # Copy single file',
      'cp -r dir1/ dir2/                 # Copy directory recursively',
      'cp file1 file2 file3 dest/        # Copy multiple files',
      'cp uploads/*.txt backup/          # Copy with wildcard',
      'cp "file with spaces.txt" dest/   # Use quotes for spaces',
      'cp -r /net/pacs/queries/AccessionNumber:123_qid:7/Study_1.2.3_Head/Series_1.2.3.4_AX_T2 results/',
      '                                  # Retrieve-if-needed, then copy the series',
    ],
  },
  mv: {
    usage: 'mv [-t <dir>] <source...> [dest]',
    description: 'Move or rename files or directories (supports wildcards and multiple sources)',
    options: [
      '(given only a source, the destination is asked for)',
    ],
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
    usage: 'mkdir [-p] <directory> [directory...]',
    description: 'Create directories',
    options: [
      '-p, --parents  make missing parents too, and take a folder already there as done',
      'Without -p, as on Linux: a missing parent is "No such file or directory" and an existing folder is "File exists".',
    ],
    examples: [
      'mkdir newdir               # Create single directory',
      'mkdir dir1 dir2            # Create multiple directories',
      'mkdir -p experiments/run1  # Create nested directory, parents included',
      'mkdir /proc/tags/urgent    # Make a tag (setfattr hangs it on a feed)',
    ],
  },
  rmdir: {
    usage: 'rmdir <directory> [directory...]',
    summary: 'Remove empty directories',
    description: 'Removes each folder only when it is empty, as on Linux: one that holds anything is '
      + '"Directory not empty". Under /proc/tags a folder is a tag: rmdir deletes a tag no feed wears.',
    examples: [
      'rmdir scratch              # Remove an empty folder',
      'rmdir /proc/tags/old       # Delete a tag no feed wears',
    ],
  },
  exit: {
    usage: 'exit',
    description: 'Exit the shell',
    examples: ['exit'],
  },
  version: {
    usage: 'version',
    description: 'Report the versions of the mise stack layers running this session',
    examples: ['version'],
  },
  fortune: {
    usage: 'fortune',
    summary: 'Print a random fortune cookie',
    description: 'Prints a random fortune — the classic UNIX fortune cookie, bundled and self-contained.',
    examples: ['fortune'],
  },
  cowsay: {
    usage: 'cowsay [-W N] [text]',
    summary: 'The ChRIS brain says it — fortune | cowsay',
    description: 'The classic, with the ChRIS brain for a cow: a speech bubble over the mascot. Says what is piped in, else the words given; -W N wraps at N columns (40 by default).',
    options: ['  -W N    Wrap the bubble at N columns (8 or more)'],
    examples: ['fortune | cowsay', 'cowsay hello, world', 'motd | cowsay -W 60'],
  },
  cowthink: {
    usage: 'cowthink [-W N] [text]',
    summary: 'The ChRIS brain thinks it',
    description: 'cowsay with a thought bubble.',
    examples: ['fortune | cowthink'],
  },
  figlet: {
    usage: 'figlet [text]',
    summary: 'Big letters, solid',
    description: 'Sets words in a five-row face of solid blocks. Letters, digits and the punctuation a title needs; lowercase is set as capitals. Reads what is piped in, else the words given.',
    examples: ['figlet LCARS', 'date +%H:%M | figlet'],
  },
  banner: {
    usage: 'banner [text]',
    summary: 'Big letters in #, as banner drew them',
    description: 'figlet in the face banner used: # for ink.',
    examples: ['banner ChRIS'],
  },
  lolcat: {
    usage: 'lolcat [-p SPREAD] [-S PHASE] [text]',
    summary: 'Text in a rainbow',
    description: 'Paints each character the next hue along a rainbow, drifting down the lines. -p sets how many characters one cycle spans (24), -S where it starts (random). Reads what is piped in, else the words given.',
    options: ['  -p SPREAD   Characters per rainbow cycle (1 or more)', '  -S PHASE    Where the rainbow starts'],
    examples: ['fortune | lolcat', 'figlet ARGUS | lolcat', 'motd | lolcat -p 12'],
  },
  rev: {
    usage: 'rev [text]',
    summary: 'Reverse each line',
    description: 'Reverses the characters of each line, keeping the lines in order. Reads what is piped in, else the words given.',
    examples: ['rev stressed', 'fortune | rev'],
  },
  tac: {
    usage: 'tac [text]',
    summary: 'Lines last to first',
    description: 'cat backwards: prints the lines in reverse order. Reads what is piped in.',
    examples: ['help games | tac', 'seq 5 | tac'],
  },
  yes: {
    usage: 'yes [word] [-n N]',
    summary: 'Repeat a word (ten times, not forever)',
    description: 'Prints a word on its own line, over and over — but bounded: ten times unless -n N asks for more (up to 10000), and it says how many it printed. The real yes runs until killed; a session is not the place.',
    options: ['  -n N    Lines to print (default 10, at most 10000)'],
    examples: ['yes', 'yes no -n 3', 'yes | head -n 2'],
  },
  seq: {
    usage: 'seq [FIRST [STEP]] LAST',
    summary: 'Count from one number to another',
    description: 'Prints the numbers from FIRST to LAST by STEP, one per line, as seq does: seq 5 is 1 to 5, seq 2 10 is 2 to 10, seq 10 -2 0 counts down. At most 100000 numbers.',
    examples: ['seq 5', 'seq 0 5 30', 'seq 10 -1 1 | tac'],
  },
  factor: {
    usage: 'factor N [N...]',
    summary: 'Prime factors of a number',
    description: 'Prints each number with its prime factors, smallest first, repeats included, as factor does.',
    examples: ['factor 360', 'factor 2026 1729'],
  },
  primes: {
    usage: 'primes [FROM] TO',
    summary: 'The primes up to a number',
    description: 'Lists the primes from FROM (2 when omitted) to TO, at most 10000 of them.',
    examples: ['primes 100', 'primes 1000 1100'],
  },
  shuf: {
    usage: 'shuf [words...]',
    summary: 'Shuffle lines',
    description: 'Prints the lines piped in, or the words given, in a random order.',
    examples: ['shuf a b c d', 'ls | shuf', 'seq 10 | shuf'],
  },
  roll: {
    usage: 'roll [NdS[+M]...]',
    summary: 'Roll dice: roll 2d6+1, roll d20',
    description: 'Rolls dice written the tabletop way: N dice of S sides, plus or minus a modifier. Bare roll is one six-sided die. Shows each face and the total.',
    examples: ['roll', 'roll 2d6', 'roll d20 3d8+2'],
  },
  rot13: {
    usage: 'rot13 [text]',
    summary: 'Turn letters half the alphabet round',
    description: 'ROT13: each letter moved thirteen places, so applying it twice gives the text back. Reads what is piped in, else the words given.',
    examples: ['rot13 hello', 'fortune | rot13 | rot13'],
  },
  morse: {
    usage: 'morse [-d] [text]',
    summary: 'Text to Morse code and back',
    description: 'Taps text out in International Morse — one space between letters, a slash between words — or, with -d, reads code back into text. Reads what is piped in, else the words given.',
    options: ['  -d, --decode   Read code into text'],
    examples: ['morse sos', 'morse -d ... --- ...', 'fortune | morse'],
  },
  calc: {
    usage: 'calc <expression>',
    summary: 'Arithmetic: calc 2^10, calc sqrt(2)*pi',
    description: 'Evaluates an arithmetic expression: + - * / % ^, parentheses, sqrt, abs, ln, log, log2, exp, sin, cos, tan, asin, acos, atan, floor, ceil, round, and the constants pi, e and tau. No shell is involved.',
    examples: ['calc 2^10', 'calc (3+4)*5', 'calc sqrt(2)*pi', 'calc 1024*1024'],
  },
  units: {
    usage: 'units VALUE FROM [to] TO | units list',
    summary: 'Convert between units: units 10 mm in',
    description: 'Converts a quantity between two units of one kind: length (mm cm m km in ft yd mi), mass (g kg mg lb oz), time (ms s min h d wk yr), data (B kB MB GB TB KiB MiB GiB TiB bit) and temperature (C F K). units list names them all.',
    examples: ['units 10 mm in', 'units 72 F to C', 'units 1 GiB MB', 'units list'],
  },
  who: {
    usage: 'who',
    summary: 'Who is attached to this session',
    description: 'Lists the surfaces on this session — each terminal and browser, by the host\'s name for it — marking the one you are at. A local shell answers for itself alone.',
    examples: ['who'],
  },
  uptime: {
    usage: 'uptime',
    summary: 'How long this session\'s process has been up',
    description: 'The time, how long the process serving this session has run, how many surfaces are attached, since when, and its pid.',
    examples: ['uptime'],
  },
  say: {
    usage: 'say [text]',
    summary: 'A surface with a voice speaks it',
    description: 'Hands words to the surface: a browser speaks them (ARGUS, through the page\'s speech), a terminal prints them. Reads what is piped in, else the words given.',
    examples: ['say analysis complete', 'fortune | say'],
  },
  wtf: {
    usage: 'wtf [is] <term>... | wtf -l',
    summary: 'What an acronym means: wtf is lonk',
    description: 'BSD\'s acronym expander with the lab\'s own book: ChRIS, CUBE, pfdcm, oxidicom, LONK, PACS, DICOM, MRN, SeaGaP, the mise packages and more. A term the book lacks is said so; -l lists every term it has.',
    options: ['  -l, --list   Every term in the book'],
    examples: ['wtf is lonk', 'wtf cube pfdcm', 'wtf -l'],
  },
  qr: {
    usage: 'qr <text or URL>',
    summary: 'A QR code in the console, for a phone',
    description: 'Draws a QR code of the text — a URL, mostly — in half-block characters, light modules bright so a phone camera reads it off a dark screen. Up to 271 bytes (QR versions 1 to 10, error correction L), encoded here with no library.',
    examples: ['qr https://titan.tch.harvard.edu', 'whereami | qr'],
  },
  pom: {
    usage: 'pom [date]',
    summary: 'The phase of the moon',
    description: 'BSD\'s pom: the Moon\'s phase today (or on a date), how much of it is lit, the days to the next full and new moons, and a small moon drawn as it looks.',
    examples: ['pom', 'pom 2026-12-25'],
  },
  stardate: {
    usage: 'stardate [date]',
    summary: 'The stardate, two ways',
    description: 'The day as a stardate: by the Kelvin films\' reckoning (the year, then the day of it), with TNG\'s thousand-a-year count from 2323 beside it.',
    examples: ['stardate', 'stardate 2366-01-01'],
  },
  ddate: {
    usage: 'ddate [date]',
    summary: 'The Discordian date',
    description: 'Today in the Discordian calendar: five seasons of 73 days, a five-day week, St. Tib\'s Day in a leap year, and the holy days called out. Hail Eris.',
    examples: ['ddate', 'ddate 2028-02-29'],
  },
  sunrise: {
    usage: 'sunrise [place]',
    summary: 'When the sun rises and sets at a place',
    description: 'Asks Open-Meteo (the service weather uses; no key) for sunrise, sunset and the length of the day at a place, today and tomorrow, in the place\'s own time. Boston when no place is named. Needs the session host to reach the internet.',
    examples: ['sunrise', 'sunrise Cape Town', 'sunrise Tromsø'],
  },
  timer: {
    usage: 'timer <duration> [words] | timer | timer cancel [id|all]',
    summary: 'A chime after a while: timer 5m tea',
    description: 'Sets a chime for later — 90s, 5m, 1h30m, 2:30, or a bare number of minutes — with the words to say when it sounds. The chime reaches every surface on the session: ARGUS notes it in the console and speaks it, a remote chell prints it. Nothing waits: the console is yours meanwhile. Bare timer lists the chimes waiting; timer cancel ends them. A chime lives as long as the session\'s process.',
    examples: ['timer 5m tea', 'timer 25m pomodoro over', 'timer 1:30', 'timer', 'timer cancel 2'],
  },
  leave: {
    usage: 'leave [+hhmm | hhmm] | leave cancel',
    summary: 'A word when it is time to go home: leave +0030',
    description: 'BSD\'s leave: tell it when you must leave — +hhmm from now, or a clock time — and it says so five minutes before, at the time, and a minute after. Bare leave says when; leave cancel forgets it.',
    examples: ['leave +0030', 'leave 1730', 'leave', 'leave cancel'],
  },
  stopwatch: {
    usage: 'stopwatch [start|stop|lap|reset]',
    summary: 'A stopwatch, with laps',
    description: 'One stopwatch per session: start, stop (and start again to resume), lap, reset. Bare stopwatch shows the time and the laps.',
    examples: ['stopwatch start', 'stopwatch lap', 'stopwatch', 'stopwatch stop'],
  },
  sl: {
    usage: 'sl',
    summary: 'A starship crosses the screen (the punishment for mistyping ls)',
    description: 'The train of old, refitted: in ARGUS the GAMES pane opens and a starship glides across it; a console with no canvas gets a still of it.',
    examples: ['sl'],
  },
  cmatrix: {
    usage: 'cmatrix',
    summary: 'The glyph rain',
    description: 'Columns of glyphs falling in ARGUS\'s GAMES pane; a console with no canvas gets one frame of it.',
    examples: ['cmatrix'],
  },
  rain: {
    usage: 'rain',
    summary: 'Rain',
    description: 'Drops falling and ringing out on the floor in ARGUS\'s GAMES pane; a console with no canvas gets one frame of it.',
    examples: ['rain'],
  },
  asciiquarium: {
    usage: 'asciiquarium',
    summary: 'An aquarium: fish, weed, bubbles',
    description: 'Fish swimming both ways, weed swaying, bubbles rising, in ARGUS\'s GAMES pane; a console with no canvas gets a still.',
    examples: ['asciiquarium'],
  },
  tetris: {
    usage: 'tetris',
    summary: 'Falling blocks (in ARGUS)',
    description: 'Played in ARGUS\'s GAMES pane: left/right move, up rotates, down drops, Esc gives the keyboard back. A terminal gets a still and the words that the game lives in ARGUS.',
    examples: ['tetris'],
  },
  snake: {
    usage: 'snake',
    summary: 'The snake (in ARGUS)',
    description: 'Played in ARGUS\'s GAMES pane: arrows steer, eat the food, do not eat yourself. A terminal gets a still and the words that the game lives in ARGUS.',
    examples: ['snake'],
  },
  quiz: {
    usage: 'quiz',
    summary: 'Five questions about the lab and its words',
    description: 'Asks five questions from the lab\'s own book — CUBE, DICOM, plugins, the services — one at a time; answer, or q to stop. Plays anywhere a question can be answered: a terminal or the ARGUS console.',
    examples: ['quiz'],
  },
  hangman: {
    usage: 'hangman',
    summary: 'Hangman, with the lab\'s words',
    description: 'A word from the lab, six misses allowed: a letter a turn, the whole word when you know it, q to give up.',
    examples: ['hangman'],
  },
  '2048': {
    usage: '2048',
    summary: 'Slide the tiles, join the powers of two',
    description: 'The 4×4 board, a move per answer: w a s d (or h j k l) slide, q stops. Two tiles alike join; reach 2048.',
    examples: ['2048'],
  },
  notes: {
    usage: 'notes [--since N|YYYY-MM-DD] [--all] [--long]',
    summary: 'What the installed releases changed, for the operator',
    description: 'Reads the release notes shipped with the packages installed where this session runs — argus, brasa, chell, calypso, porter — and lists the newest release: one row per change, the package tagged. --since N shows the last N releases, --since DATE everything from a day on; --long unfolds each change beneath its first sentence; --all includes the changes marked Internal. help notes is the same. In ARGUS the WHAT\'S NEW block opens them as a listing.',
    examples: ['notes', 'notes --since 3', 'notes --since 2026-10-01 --long', 'notes --all'],
  },
  weather: {
    usage: 'weather [place] [-u|--units metric|imperial] [-d|--days N]',
    summary: 'The weather at a place, now and the next few days',
    description: 'Reports the current conditions and a short forecast for a place, from Open-Meteo (no key, no account). The place is found by name; with none given it is Boston. Metric (°C, km/h) unless --units imperial asks for °F and mph. The call is made from the session host, so it needs that host to reach the internet.',
    options: [
      '  -u, --units SYS   metric (default: °C, km/h) or imperial (°F, mph)',
      '  -d, --days N      Days of forecast to show (default 3, at most 16)',
    ],
    examples: ['weather', 'weather Cape Town', 'weather Boston --units imperial', 'weather Paris -d 7'],
  },
  date: {
    usage: 'date [-u] [+FORMAT]',
    summary: 'Print the current date and time',
    description: 'Prints the current date and time, in the spirit of UNIX date. Use -u for UTC and +FORMAT for a strftime-style format string. Reports the time only; it never sets the clock.',
    options: [
      '  -u, --utc         Print (or interpret) time in UTC',
      '  +FORMAT           strftime-style format (e.g. +%Y-%m-%d, +%H:%M:%S)',
    ],
    examples: ['date', 'date -u', 'date +%Y-%m-%d', 'date "+%A, %B %e %Y"'],
  },
  cal: {
    usage: 'cal [[month] year]',
    summary: 'Print a calendar',
    description: 'Prints a month or year calendar with today highlighted, in the spirit of UNIX cal.',
    examples: ['cal', 'cal 2026', 'cal 7 2026'],
  },
  prompt: {
    usage: 'prompt [list | <theme>]',
    description: 'List available prompt themes or switch the active theme',
    options: [
      'list        Show all available themes (marks the active one)',
      '<theme>     Switch to the named theme immediately',
    ],
    examples: [
      'prompt             # Show current theme',
      'prompt list        # List all themes',
      'prompt default     # Switch to single-line smart-truncation theme',
      'prompt p10k        # Switch to two-line Powerlevel10k-inspired theme',
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
  help: {
    usage: 'help [command]',
    description: 'Display help information',
    examples: [
      'help                  # List all commands',
      'help games            # The /usr/games shelf, by category',
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

// The help is registered with the engine's commands; every reader below goes
// through the registry, never this record.
commands_register({ help: helpText });

/**
 * Displays help text for a command.
 *
 * @param command - The command to display help for.
 */
/**
 * Formats and returns the detailed help text for a specific command as a string.
 *
 * @param command - The command name to retrieve help for.
/**
 * Word-wraps a flat string to fit within a given width, with uniform indentation.
 *
 * @param str    - Input text (single line or freeform).
 * @param width  - Total line width including indent (default 78).
 * @param indent - Leading spaces on every line (default 2).
 * @returns Multi-line string, each line at most `width` chars wide.
 */
export function text_boxFormat(str: string, width: number = 78, indent: number = 2): string {
  const prefix: string = ' '.repeat(indent);
  const maxContent: number = Math.max(1, width - indent);
  const words: string[] = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current: string = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxContent) {
      current += ' ' + word;
    } else {
      lines.push(prefix + current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(prefix + current);
  return lines.join('\n');
}

/** Formats one command-help descriptor. */
function commandHelp_render(command: string, help: CommandHelp): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold.magenta(command.toUpperCase()));
  lines.push(chalk.gray('─'.repeat(60)));
  lines.push('');
  
  lines.push(chalk.bold.blue('USAGE'));
  const usageParts: string[] = help.usage.split(' ');
  const cmdName: string = usageParts[0];
  const args: string = usageParts.slice(1).join(' ');
  lines.push(`  ${chalk.green(cmdName)} ${chalk.cyan(args)}`);
  
  lines.push('');
  lines.push(chalk.bold.blue('DESCRIPTION'));
  text_boxFormat(help.description, 78, 2).split('\n').forEach((l: string) => lines.push(l));

  if (help.subcommands && help.subcommands.length > 0) {
    lines.push('');
    lines.push(chalk.bold.blue('SUBCOMMANDS'));
    help.subcommands.forEach((opt: string) => {
      const trimmed: string = opt.trim();
      if (!trimmed) { lines.push(''); return; }
      lines.push(`  ${trimmed}`);
    });
  }

  if (help.options && help.options.length > 0) {
    lines.push('');
    lines.push(chalk.bold.blue('OPTIONS'));
    help.options.forEach((opt: string) => {
      const trimmed: string = opt.trim();
      if (!trimmed) {
        lines.push('');
        return;
      }
      
      // Check if it's a header (ends with :)
      if (trimmed.endsWith(':')) {
        lines.push(`  ${chalk.bold.white(trimmed)}`);
        return;
      }

      // Try to split by double space (common separator in help definitions)
      const splitMatch: RegExpMatchArray | null = opt.match(/^(\s*)(.*?)(\s{2,})(.*)$/);
      
      if (splitMatch) {
        const [, indent, content, separator, description] = splitMatch;
        lines.push(`  ${indent}${chalk.yellow(content)}${separator}${description}`);
      } else {
        // Fallback: check if it starts with -
        if (trimmed.startsWith('-')) {
          lines.push(`  ${chalk.yellow(opt)}`);
        } else {
          lines.push(`  ${opt}`);
        }
      }
    });
  }

  if (help.examples && help.examples.length > 0) {
    lines.push('');
    lines.push(chalk.bold.blue('EXAMPLES'));
    help.examples.forEach((ex: string) => {
      const commentIdx: number = ex.indexOf('#');
      if (commentIdx !== -1) {
        const cmdPart: string = ex.substring(0, commentIdx);
        const commentPart: string = ex.substring(commentIdx);
        lines.push(`  ${chalk.white(cmdPart)}${chalk.gray(commentPart)}`);
      } else {
        lines.push(`  ${chalk.white(ex)}`);
      }
    });
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Gets the formatted help text for a registered command.
 *
 * @param command - Registered builtin command name.
 * @returns The formatted help text string, or undefined if no help exists.
 */
export function commandHelp_get(command: string): string | undefined {
  const help: CommandHelp | undefined = commandHelpEntry_get(command);
  return help ? commandHelp_render(command, help) : undefined;
}

/**
 * Renders contextual help for one registered pipeline executable.
 *
 * @param name - Pipeline executable name as exposed in `/bin`.
 * @returns Pipeline-specific help text, terminated with a newline.
 */
export function pipelineExecutableHelp_render(name: string): string {
  const help: CommandHelp = {
    usage: `${name} [run options]`,
    description: 'Run or inspect this registered CUBE pipeline.',
    options: [
      'DIAGRAM OUTPUT:',
      '  --diagram               Draw the shallow pipeline topology',
      '  --diagram --withargs    Include stored non-null defaults inline',
      '  --signalflow            Emit SignalFlow YAML',
      '  --diagram --signalflow  Compatible explicit SignalFlow spelling',
      '',
      'INSPECTION:',
      '  --nodes, --parameters   Show pipeline nodes and parameters',
      '  --source, --readme      Show the pipeline YAML source',
      '  --manifest              Emit complete registered invocation YAML',
      '',
      'EXECUTION:',
      '  --compute <resource>    Override the compute resource',
      '  --previous <inst_id>    Attach to an explicit plugin instance',
      '  --paramFile <cfs-file>  Apply one sparse YAML invocation overlay',
      '  --<node>.<parameter> <value>  Override a hosted parameter',
      '  --<node>.<control> <value>    Override a node execution control',
    ],
    examples: [
      `${name} --diagram`,
      `${name} --diagram --withargs`,
      `${name} --signalflow | signalflow -`,
      `${name} --source`,
      `${name} --manifest`,
      `${name} --previous 123`,
    ],
  };
  return `${commandHelp_render(name, help)}\n`;
}

/**
 * Renders contextual help for one versioned plugin executable.
 *
 * @param name - Plugin executable name as exposed in `/bin`.
 * @returns Plugin-specific help text, terminated with a newline.
 */
export function pluginExecutableHelp_render(name: string): string {
  const help: CommandHelp = {
    usage: `${name} <operation>`,
    description: 'Inspect this registered CUBE plugin version.',
    options: [
      '  --parameters   Show parameter definitions for this plugin version',
      '  --readme       Show the rendered plugin README',
      '  --readme --raw Output raw README markdown for piping',
    ],
    examples: [
      `${name} --parameters`,
      `${name} --readme`,
      `${name} --readme --raw | glow -`,
    ],
  };
  return `${commandHelp_render(name, help)}\n`;
}

/**
 * Renders a command's help text as a string.
 *
 * The help text is returned as a string so callers can carry it in an envelope
 * and deliver it through the sink, rather than printing to the console — which
 * on a daemon would land on the daemon's terminal instead of the surface.
 *
 * @param command - The command to render help for.
 * @returns The help text, terminated with a newline.
 */
export function help_render(command: string): string {
  const helpStr: string | undefined = commandHelp_get(command);
  if (helpStr !== undefined) {
    return `${helpStr}\n`;
  }
  return helpMissing_render(command);
}

/**
 * The page for a name with no help in this session.
 *
 * @param command - The name asked about.
 * @returns The page.
 */
export function helpMissing_render(command: string): string {
  return `${chalk.yellow(`No help available for '${command}'`)}\n${chalk.gray('Type "help" to see all available commands.')}\n`;
}

/** Words the shell or its surface answers itself, with no handler in the registry. */
const SHELL_WORDS: ReadonlyArray<string> = ['exit', '!', 'help', 'prompt'];

/**
 * Whether this session can run a verb (or a verb's subcommand, `pacs query`):
 * its handler is registered (the core's, or its backend's), or the shell
 * answers it. Help is shown only for what can be run.
 *
 * @param name - The command, perhaps with a subcommand.
 * @returns True when the session has it.
 */
export function verb_available(name: string): boolean {
  const verb: string = name.split(' ')[0] ?? '';
  if (SHELL_WORDS.includes(verb)) return true;
  if (verb === 'sudo') return backendInstalled_get()?.elevate !== undefined;
  return builtinCommand_has(verb);
}

/**
 * Checks if arguments contain --help flag.
 * -h is treated as help unless the command uses it for "human-readable" (ls, du).
 *
 * @param args - Command arguments.
 * @param command - The command name (optional).
 * @returns True if help is requested.
 */
export function args_checkHasHelpFlag(args: string[], command?: string): boolean {
  const isPluginExecutable: boolean = !!command && /-v.+$/.test(command);
  if (!isPluginExecutable && args.includes('--help')) return true;

  // Commands where -h means human-readable sizes, not help
  const humanReadableCommands: string[] = ['ls', 'du'];
  
  if (command && humanReadableCommands.includes(command)) {
    return false;
  }
  
  if (isPluginExecutable) {
    return false;
  }

  return args.includes('-h');
}

/**
 * Builtin help command - displays command list or specific command help.
 *
 * @param args - Command arguments (optional command name).
 */
export async function builtin_help(args: string[]): Promise<CommandEnvelope> {
  const commandName: string | undefined = args.length > 0 ? args.join(' ') : undefined;

  // The shelf: its own page, in the style of this one.
  if (commandName === 'games') {
    return { status: 'ok', rendered: gamesShelf_render(commandSummary_get) };
  }
  // The release notes: `help notes` is `notes`. Loaded on the press, not at
  // import: the notes module reads the wire's model schemas, which this page
  // otherwise never needs.
  if (commandName === 'notes') {
    const { builtin_notes } = await import('./sys/notes.js');
    return builtin_notes([]);
  }
  // If a specific command is requested, return its help
  // A verb this session has; else whatever its backend answers for (ChRIS:
  // a plugin or pipeline executable); else no help, never a page for a verb
  // the session cannot run.
  if (commandName) {
    if (verb_available(commandName)) return { status: 'ok', rendered: help_render(commandName) };
    const backendHelp: string | null = (await backendInstalled_get()?.fallback?.help?.(commandName)) ?? null;
    return { status: 'ok', rendered: backendHelp ?? helpMissing_render(commandName) };
  }

  // Otherwise, list all available commands
  let rendered: string = '';
  rendered += '\n';
  rendered += `${chalk.bold.cyan('ChELL - Available Commands')}\n`;
  rendered += `${chalk.gray('─'.repeat(60))}\n`;
  rendered += '\n';

  // Group commands by category
  const categories: Record<string, string[]> = {
    Navigation: ['cd', 'pwd', 'ls', 'tree', 'du'],
    'File Operations': ['cat', 'edit', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'rmdir', 'upload', 'download'],
    'Sharing & Tags': ['setfacl', 'getfacl', 'chmod', 'getfattr', 'setfattr'],
    Connection: ['connect', 'logout', 'context', 'id', 'whoami', 'whereami', 'netstat'],
    Monitoring: ['proc'],
    Imaging: ['dcm', 'image'],
    'Single Resource': ['plugin', 'pipeline', 'feed', 'tag', 'group', 'pluginmeta', 'plugininstance', 'workflow'],
    'Resource Collections': ['plugins', 'feeds', 'files', 'links', 'dirs', 'store', 'compute', 'tags', 'groups', 'pluginmetas', 'plugininstances', 'workflows', 'parametersofplugin'],
    PACS: ['pacs', 'pacsservers', 'pacsqueries', 'pacsretrieve'],
    Administration: ['sudo', 'user'],
    'Shell Settings': ['physicalmode', 'prompt', 'timing', 'debug'],
    'Games and utilities': ['fortune', 'cal', 'weather', 'motd'],
    General: ['help', 'notes', 'date', 'exit', '!'],
  };

  // Display commands by category
  for (const [category, commands] of Object.entries(categories)) {
    const runnable: string[] = commands.filter((cmd: string): boolean => verb_available(cmd) && commandHelpEntry_get(cmd) !== undefined);
    if (runnable.length === 0 && category !== 'Games and utilities') continue;
    rendered += `${chalk.bold.yellow(category)}\n`;
    runnable.forEach((cmd: string) => {
      const help: CommandHelp | undefined = commandHelpEntry_get(cmd);
      if (help) {
        rendered += `  ${chalk.cyan(cmd.padEnd(20))} ${chalk.gray(help.summary ?? help.description)}\n`;
      }
    });
    // The four above are the shelf's best known; the rest of /usr/games is
    // its own page, and the count is read from the shelf so it never goes stale.
    if (category === 'Games and utilities') {
      const more: number = gamesShelf_names(commandSummary_get).length - runnable.length;
      rendered += `  ${chalk.cyan('help games'.padEnd(20))} ${chalk.gray(`The /usr/games shelf by category: ${more} more small tools and games`)}\n`;
    }
    rendered += '\n';
  }

  // Display Shell Features
  rendered += `${chalk.bold.yellow('Shell Features')}\n`;
  rendered += `  ${chalk.cyan('Pipes'.padEnd(20))} ${chalk.gray('Chain commands: cat file.txt | wc -l')}\n`;
  rendered += `  ${chalk.cyan('Redirection >'.padEnd(20))} ${chalk.gray('Write to file: cat file.txt > output.txt')}\n`;
  rendered += `  ${chalk.cyan('Redirection >>'.padEnd(20))} ${chalk.gray('Append to file: cat file.txt >> output.txt')}\n`;
  rendered += '\n';

  rendered += `${chalk.gray('Type "help <command>" for detailed information about a command.')}\n`;
  rendered += `${chalk.gray('Type "<command> --help" for quick help on any command.')}\n`;
  rendered += '\n';

  return { status: 'ok', rendered };
}

/**
 * Gets the list of all builtin command names.
 *
 * @returns Array of builtin command names.
 */
export function builtinCommands_list(): string[] {
  // `/usr/bin` and completion offer what this session can run, never a
  // backend's verbs it does not have.
  return helpTopic_names().filter((name: string): boolean => verb_available(name));
}

/**
 * A command's one-line summary (its `summary`, else its description), for
 * a listing that names many commands at once.
 *
 * @param command - The command.
 * @returns The line, or undefined for a command with no help entry.
 */
export function commandSummary_get(command: string): string | undefined {
  const help: CommandHelp | undefined = commandHelpEntry_get(command);
  return help === undefined ? undefined : (help.summary ?? help.description);
}

/**
 * Gets the description for a builtin command.
 *
 * @param command - The command name.
 * @returns The command description, or undefined if not found.
 */
export function builtinCommand_descriptionGet(command: string): string | undefined {
  return commandHelpEntry_get(command)?.description;
}
