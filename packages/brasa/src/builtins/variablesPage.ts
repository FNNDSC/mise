/**
 * @file The variables page (`help variables`): its own module, so the core's
 * help and a backend's help can both reach it without importing each other.
 *
 * @module
 */
import chalk from 'chalk';

/**
 * The variables page: how a line names what a command answered, how a
 * `${name}` reads it, the session's own built-in names (the core's and the
 * lines a backend adds), and the index handles that ride beside them.
 *
 * @param backendLines - The backend's built-in lines, already indented.
 * @returns The page.
 */
export function variablesPage_render(backendLines: ReadonlyArray<string>): string {
  const lines: string[] = [
    '',
    chalk.bold.yellow('VARIABLES'),
    chalk.gray('─'.repeat(60)),
    'A variable names what a command answered, so a later line can say which',
    'thing it means instead of copying an id out of a readout.',
    '',
    '  A=$(command)      holds what the command answered: its model, or the',
    '                    text it printed when it has none. It still prints.',
    "  NAME=word         holds one word; quote a value with spaces",
    '  ${A}              its rows (a listing\'s paths, text\'s lines, a',
    '                    pipeline\'s nodes); one record refuses, naming its fields',
    '  ${A.field}        a field of its model, as the model names it; a field',
    '                    that is a list reaches through it, one operand each',
    '  set   set A       list the variables; show one whole',
    '  unset A           remove one',
    '',
    'A command that fails fails the line and leaves the name as it was. A',
    'capture is a snapshot; the built-ins below are read live. Variables live',
    "for the session. A play gets its own: its @param values, read-only, and",
    "nothing of the caller's; @answers NAME makes X=$(play f) hold NAME.",
    '',
    chalk.bold('Built-in, read-only'),
    '  ${cwd}           where the session is standing',
    '  ${listing}       the held listing\'s rows as it stands (its series, files or folders)',
    ...backendLines,
    '',
    chalk.bold('Index handles'),
    '  @SER3  @STD1-4  @FIL2,5,7  name rows of the held listing: the last',
    '  numbered listing (query, query --table, gather list, ls -l). Its footer',
    '  says what is numbered now: numbered: @PAT1, @STD1-9, @SER1-235.',
    '',
    chalk.gray('Example: A=$(pl-dcm2niix-v1.0.2)   then   cd ${A.outputPath}'),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
