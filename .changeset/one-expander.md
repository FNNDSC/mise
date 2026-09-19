---
"@fnndsc/brasa": minor
---

brasa: one expander, owned by the tokenizer.

There were two, over one syntax. The dispatcher substituted the environment AFTER tokenizing, so a single-quoted `$HOME` expanded anyway and quoting could protect nothing. `play` substituted parameters and session pronouns BEFORE tokenizing, so a gathered path with a space had to be quoted by hand and an unresolved pronoun could fall through to the other expander. Two sources of truth that composed by accident.

Now the tokenizer records references with the quoting they were written in, and one resolver answers them: the session's reserved pronouns (`gather`, `gather.first.place`, `feed`, `run`, `run.place`, `query`, `cwd`), then the played manifest's parameters, then the environment. `play` no longer substitutes anything; a manifest that declares a `@param` with a reserved name is refused when the file is read.

The shell's rules, kept, because the stack claims to wear them: a bare reference carrying several values becomes several operands, a double-quoted one stays a single operand, a single-quoted `$` is text, and an expanded value never globs afterwards. The command word expands too — a manifest names its plugin as a parameter so the same workflow runs where the builds differ.

A reference nothing answers now REFUSES the line, naming it and where it looked, rather than expanding to nothing or standing as text: `rm -rf ${DIR}/scratch` with `DIR` unset is how a script deletes the wrong thing. A dry run is the one exception, having run nothing yet.

Behaviour changes worth knowing: `'$HOME'` in single quotes no longer expands (it did, wrongly), and an unset reference refuses where it used to be left as literal text.
