/**
 * @file The games shelf: `/usr/games`, as BSD shipped it.
 *
 * BSD kept its small pleasures apart from its tools — `fortune`, `pom`,
 * `wtf`, `worms` — in `/usr/games`, with their own manual section. chell
 * keeps the same shelf: `help games` lists it in categories, `ls /usr/games`
 * walks it, and each command's help is the one declaration it has (in
 * `help.ts`, where every command's is). The shelf names the commands and
 * their categories only; a name here with no help entry is not listed, so
 * the page never promises a command that has not landed.
 *
 * @module
 */
import chalk from 'chalk';

/** One category on the shelf. */
export interface GamesCategory {
  /** The heading, as the page prints it. */
  title: string;
  /** What the category holds, in a line. */
  note: string;
  /** The commands, in the order the page lists them. */
  commands: ReadonlyArray<string>;
}

/** The shelf, in reading order. A command appears once. */
export const GAMES_SHELF: ReadonlyArray<GamesCategory> = [
  {
    title: 'Text toys',
    note: 'pipe fodder: fortune | cowsay, and friends',
    commands: ['fortune', 'cowsay', 'cowthink', 'figlet', 'banner', 'lolcat', 'rev', 'tac', 'yes', 'seq', 'factor', 'primes', 'shuf', 'roll', 'rot13', 'morse', 'calc', 'units'],
  },
  {
    title: 'Time and sky',
    note: 'the calendar, the weather, the moon and the stardate',
    commands: ['cal', 'date', 'weather', 'stardate', 'pom', 'sunrise', 'ddate', 'leave', 'timer', 'stopwatch'],
  },
  {
    title: "The lab's own",
    note: 'small tools that happen to be fun',
    commands: ['motd', 'wtf', 'chrisfetch', 'who', 'uptime', 'ping', 'qr', 'file', 'xxd', 'strings', 'sha256sum', 'md5sum', 'say'],
  },
  {
    title: 'Showpieces and games',
    note: 'drawn in ARGUS; the console gets the text',
    commands: ['sl', 'cmatrix', 'asciiquarium', 'rain', 'tetris', '2048', 'snake', 'quiz', 'hangman'],
  },
];

/** A command's one-line summary, when it has a help entry. */
export type SummaryLookup = (command: string) => string | undefined;

/**
 * The commands on the shelf that exist: those with a help entry.
 *
 * @param summary_of - The help lookup.
 * @returns The names, shelf order.
 */
export function gamesShelf_names(summary_of: SummaryLookup): string[] {
  return GAMES_SHELF.flatMap((category: GamesCategory): string[] =>
    category.commands.filter((command: string): boolean => summary_of(command) !== undefined));
}

/**
 * Renders `help games`: the shelf by category, in the style of bare `help`.
 *
 * @param summary_of - The help lookup; a command without one is left off.
 * @returns The page.
 */
export function gamesShelf_render(summary_of: SummaryLookup): string {
  let out: string = '\n';
  out += `${chalk.bold.cyan('/usr/games — the shelf')}\n`;
  out += `${chalk.gray('─'.repeat(60))}\n`;
  out += `${chalk.gray('Small pleasures, kept apart from the tools as BSD kept them. Every one is built in: no host binary, same words in chell and ARGUS.')}\n\n`;
  for (const category of GAMES_SHELF) {
    const present: string[] = category.commands.filter((command: string): boolean => summary_of(command) !== undefined);
    if (present.length === 0) continue;
    out += `${chalk.bold.yellow(category.title)}  ${chalk.gray(category.note)}\n`;
    for (const command of present) {
      out += `  ${chalk.cyan(command.padEnd(20))} ${chalk.gray(summary_of(command) ?? '')}\n`;
    }
    out += '\n';
  }
  out += `${chalk.gray('Type "help <command>" for one of them; "ls /usr/games" walks the shelf.')}\n\n`;
  return out;
}
