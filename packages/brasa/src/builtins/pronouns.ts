/**
 * @file The pronouns page (`help pronouns`): its own module, so the core's
 * help and a backend's help can both reach it without importing each other.
 *
 * @module
 */
import chalk from 'chalk';

/**
 * The pronouns page: what a `${name}` is, the core's own, the lines a
 * backend adds, and the index handles that ride beside them.
 *
 * @param backendLines - The backend's pronoun lines, already indented.
 * @returns The page.
 */
export function pronounsPage_render(backendLines: ReadonlyArray<string>): string {
  const lines: string[] = [
    '',
    chalk.bold.yellow('PRONOUNS'),
    chalk.gray('─'.repeat(60)),
    'A pronoun is a ${name} chell fills in before it runs the line: what this',
    'session just made or asked, so you never copy an id out of a readout.',
    'They live for the session only. One with nothing behind it refuses the',
    'line rather than standing for nothing.',
    '',
    '  ${cwd}           where the session is standing',
    '  ${listing}       the held listing\'s rows as it stands (its series, files or folders)',
    ...backendLines,
    '',
    chalk.bold('Index handles'),
    '  @SER3  @STD1-4  @FIL2,5,7  name rows of the held listing: the last',
    '  numbered listing (query, query --table, gather list, ls -l). Its footer',
    '  says what is numbered now: numbered: @PAT1, @STD1-9, @SER1-235.',
    '',
    chalk.gray('Example: gather add @SER3 ${query}'),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

