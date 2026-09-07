---
"@fnndsc/menu": minor
---

feat(menu): a question says what kind of value it wants

The wire has always carried a question — `prompt` / `promptAnswer` / `promptError` — and a surface has only ever been able to answer it with a line of text. That is enough for a terminal and not enough for anything else: argus refuses every prompt outright (`the argus surface cannot answer prompts`), so `sudo` dead-ends in the web surface and no control can ask for a value the operator has not already typed.

A prompt now says what it is asking FOR, so a surface can choose its instrument rather than reading the wording and guessing:

- **`wants`** — `text`, `secret`, `confirm` or `path`. Open-world: an unrecognized kind degrades to `text`, which every surface can answer, so a question from a newer daemon stays answerable rather than refused.
- **`path`** — where browsing starts, whether a file or a directory is wanted, and a basename to offer. An errand that opens nowhere in particular is a browser, not an answer.
- **`commit`** — the word the committing control should read (`EXPORT HERE`). A control reads as what it will do next.

Everything is optional, so a daemon or a surface that predates this still parses and still answers. `hidden: true` with no kind reads as `secret` — what such a daemon could only have meant — and that reconciliation is `promptKind_of` in `menu` rather than a rule each surface re-derives: two readings of one message is how a terminal and a browser end up masking different things.

No contract bump: the additions are optional, and `version_isCompatible` refuses on any mismatch, so a bump would turn a backward-compatible change into a hard break.
