---
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
---

feat: a value-taking flag given no value asks for it

`pacs query … --csv-to` with nothing after it now means "ask me where". Before, such a flag was silently ignored: the operator asked for a table and got none, which is worse than either answering or refusing.

No sigil was needed. `?` was the obvious spelling and is already a glob in `string_checkHasWildcard`, so it would have expanded against the VFS; a flag that takes a value and is given none is unambiguous on its own, and the rule now generalises to every flag in the stack without another convention.

The ask carries what it wants — a `path`, with the session's own cwd as its anchor, a suggested basename, and `EXPORT HERE` as the word its committing control should read. The anchor is a fact rather than a guess: inventing a directory means creating one behind the operator's back. And it is raised only once there is something to write, since a question about a file that may never exist is asked too early.

Two rules ride with it, both in the daemon, both about who may interrupt an operator:

* **A command marked `instrument` may never ask.** A pane's silent refresh or an ambient cycler raising a question is refused outright — the operator did not issue that command and cannot answer for it.
* **One question at a time per surface.** A second is refused by name rather than queued, because a queued question is one whose command the operator has forgotten issuing.

An abandoned ask is not a failed query: the answer stands and only the writing does not happen.

`prompt_current` now takes the whole request rather than a message and a flag, and the daemon relays `wants`, `path` and `commit` to the surface. `repl_confirm` and `repl_questionPath` join the kernel's ask helpers, so a caller states the kind once and every surface reads the same intent.
