/**
 * @file Pure argument parsing for the `pull` builtin.
 *
 * Dependency-free so it is trivially unit-testable.
 *
 * @module
 */

/**
 * Parsed `pull` arguments.
 */
export interface PullArgs {
  nowait: boolean;
  retryMax: number;
  newFeedTitle: string | null;
  parseError: string | null;
  paths: string[];
  attachment?: PullAttachment;
}

/** One plugin or pipeline requested after successful PACS Feed creation. */
export interface PullAttachment {
  /** Selected executable kind. */
  kind: 'plugin' | 'pipeline';
  /** Plugin or Pipeline selector supplied by the user. */
  selector: string;
  /** Already-tokenized payload supplied after `--`. */
  args: string[];
}

/**
 * Parses `pull` arguments: `--nowait`, `--retry N`, `--new-feed TITLE`, and
 * path operands.
 *
 * @param args - Raw command arguments.
 * @returns The parsed flags and paths.
 */
export function pullArgs_parse(args: string[]): PullArgs {
  const delimiterIndex: number = args.indexOf('--');
  const commandArgs: string[] = delimiterIndex === -1 ? args : args.slice(0, delimiterIndex);
  const forwardedArgs: string[] = delimiterIndex === -1 ? [] : args.slice(delimiterIndex + 1);
  const nowait: boolean = commandArgs.includes('--nowait');
  let retryMax: number = 0;
  let newFeedTitle: string | null = null;
  let parseError: string | null = null;
  const paths: string[] = [];
  let attachment: PullAttachment | undefined;

  for (let i: number = 0; i < commandArgs.length; i++) {
    if (commandArgs[i] === '--nowait') {
      continue;
    } else if (commandArgs[i] === '--retry') {
      const value: string | undefined = commandArgs[i + 1];
      if (value === undefined || value.startsWith('--')) {
        parseError ??= '--retry requires a non-negative integer';
        continue;
      }
      i++;
      const n: number = Number(value);
      if (Number.isInteger(n) && n >= 0) {
        retryMax = n;
      } else {
        parseError ??= '--retry requires a non-negative integer';
      }
    } else if (commandArgs[i] === '--new-feed') {
      if (newFeedTitle !== null) {
        parseError = '--new-feed may only be specified once';
      }
      const title: string | undefined = commandArgs[i + 1];
      if (title === undefined || title.startsWith('--') || title.trim().length === 0) {
        parseError ??= '--new-feed requires a title';
      } else {
        newFeedTitle = title.trim();
        i++;
      }
    } else if (commandArgs[i] === '--plugin' || commandArgs[i] === '--pipeline') {
      const flag: '--plugin' | '--pipeline' = commandArgs[i] as '--plugin' | '--pipeline';
      const selector: string | undefined = commandArgs[i + 1];
      if (attachment !== undefined) {
        parseError = '--plugin and --pipeline are mutually exclusive';
      } else if (selector === undefined || selector.startsWith('--')) {
        parseError ??= `${flag} requires a selector`;
      } else {
        attachment = {
          kind: flag === '--plugin' ? 'plugin' : 'pipeline',
          selector,
          args: forwardedArgs,
        };
        i++;
      }
    } else if (commandArgs[i].startsWith('--')) {
      parseError ??= `unsupported option: ${commandArgs[i]}`;
    } else {
      paths.push(commandArgs[i]);
    }
  }

  if (attachment !== undefined && newFeedTitle === null) {
    parseError ??= `--${attachment.kind} requires --new-feed`;
  }
  if (attachment === undefined && forwardedArgs.length > 0) {
    parseError ??= 'arguments after -- require --plugin or --pipeline';
  }
  const parsed: PullArgs = { nowait, retryMax, newFeedTitle, parseError, paths };
  if (attachment !== undefined) parsed.attachment = attachment;
  return parsed;
}
