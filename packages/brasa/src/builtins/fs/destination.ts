/**
 * @file The destination a move or a copy was not given.
 *
 * A value-taking flag given no value asks for it (#442). A required
 * OPERAND is the same sentence with the same answer: `mv foo` names what to
 * move and not where to put it, and erroring with a usage line — what it
 * did before — tells an operator something they already know instead of
 * asking them the one thing they have not said.
 *
 * What the ask carries is what makes it answerable without typing a path
 * from scratch: it opens where the source already lives, and offers the
 * source's own name, so a rename is a rename rather than a transcription.
 *
 * @module
 */
/** What a verb needs said about the destination it is asking for. */
export interface DestinationAsk {
  /** The verb asking, for the message and for its refusal. */
  verb: string;
  /** The word the committing control should read. */
  commit: string;
  /** The sources the destination is for. */
  sources: string[];
  /**
   * Whether the answer must be a DIRECTORY. Several sources always want
   * one; a single source wants one too when the caller said `-t`, which
   * names a target directory rather than a new name.
   */
  wantsDirectory?: boolean;
}

/**
 * Asks where the sources should go.
 *
 * Several sources want a DIRECTORY — that is what `mv a b c <dir>` means in
 * a shell — and one wants a path, offered as its own name so the ordinary
 * case is a rename. The anchor is the first source's own folder: a fact,
 * never a directory invented for the occasion.
 *
 * The answer comes back absolute, resolved against the directory the
 * session stood in when it asked: while the question is open other commands
 * run, and a `cd` among them must not move where a relative answer lands.
 *
 * @param ask - The verb, its committing word, and the sources.
 * @returns The destination the operator gave, absolute, or '' when they abandoned it.
 */
export async function destination_ask(ask: DestinationAsk): Promise<string> {
  const { path_resolve } = await import('../utils.js');
  const { repl_questionPath } = await import('../../core/question.js');
  const first: string = ask.sources[0] ?? '';
  const resolved: string = await path_resolve(first);
  // Where the session stands now, before the question lets anything move it.
  const here: string = await path_resolve('.');
  const cut: number = resolved.lastIndexOf('/');
  const folder: string = cut <= 0 ? '/' : resolved.slice(0, cut);
  const name: string = resolved.slice(cut + 1);
  const many: boolean = ask.sources.length > 1 || ask.wantsDirectory === true;
  try {
    const answer: string = await repl_questionPath(
      many
        ? `Where should ${ask.sources.length === 1 ? name : `these ${ask.sources.length}`} go? `
        : `Where should ${name} go? `,
      {
        // Where to look: the folder the source is already in. Nothing is
        // OFFERED — the only name this verb could propose is the source's
        // own, and answering with it moves a file onto itself. A surface
        // that browses composes its own answer from where it lands.
        anchor: folder,
        wantsDirectory: many,
      },
      ask.commit,
    );
    const given: string = answer.trim();
    if (given === '') return '';
    if (given.startsWith('/') || given.startsWith('~')) return await path_resolve(given);
    return await path_resolve(`${here === '/' ? '' : here}/${given}`);
  } catch {
    // A refused or abandoned ask is not a failure to describe: the operator
    // was asked and chose not to say.
    return '';
  }
}

/**
 * The refusal a verb gives when its destination was never named.
 *
 * Returned rather than pushed on the error stack: the caller renders it
 * into the envelope, and a message reported twice reads as two failures.
 *
 * @param verb - The verb that asked.
 * @returns The message, for an error envelope.
 */
export function destination_missing(verb: string): string {
  return `${verb}: no destination given; nothing ${verb === 'cp' ? 'copied' : 'moved'}.`;
}

/**
 * Fixes operands to absolute paths before a question is asked, so the
 * answer acts on what the operator named and not on what those names mean
 * after another command moved the session. An operand that does not resolve
 * is kept as given; the verb reports it in its place.
 *
 * @param operands - The operands as typed.
 * @returns The operands, absolute where they resolve.
 */
export async function operands_fix(operands: string[]): Promise<string[]> {
  const { path_resolve } = await import('../utils.js');
  const fixed: string[] = [];
  for (const operand of operands) {
    try {
      fixed.push(await path_resolve(operand));
    } catch {
      fixed.push(operand);
    }
  }
  return fixed;
}
