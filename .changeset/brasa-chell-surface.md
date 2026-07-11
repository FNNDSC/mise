---
"@fnndsc/chell": major
---

chell is now the CLI surface over the new `@fnndsc/brasa` engine package. The shell engine (parser, dispatch, pipes, builtins, session, output) was lifted into brasa; chell keeps the readline REPL, terminal rendering, and prompt themes.

Breaking: the `calypso` daemon binary is no longer provided by chell — it now ships with `@fnndsc/calypso`. Install that package to run the daemon (`chell --daemon` continues to work). Prompt themes now render per-surface from a pushed context rather than as a server-rendered string.
