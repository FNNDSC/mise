---
"@fnndsc/brasa": minor
---

brasa: `play` — a manifest runs, and plays.

A manifest is a text file of the lines an operator could have typed. `play` reads it and feeds those lines to the session one at a time, through the same path a typed line takes — there is no second runtime, no driver and no selector language. Because every verb lowers to a line and every line's answer is a typed model the surface renders, a manifest played at a surface PLAYS: the PACS pane fills, the cohort's face counts up, a viewer opens. Played headlessly the same file prints the same envelopes and exits 0 or non-zero. Neither run knows which it is.

A file says what it is (`@name`, `@description`) and what it needs (`@param NAME`, `@param NAME = default`). Everything it needs is settled BEFORE the first line runs: a manifest that gets half way and then asks has already changed the session. Lines may refer to what the session just did through a closed set of pronouns — `${gather}`, `${gather.first}`, `${gather.3}`, `${gather.size}`, `${feed}`, `${run}`, `${query}`, `${cwd}` — and a pronoun the session cannot answer refuses by name rather than expanding to nothing.

A member of a cohort has two addresses and the difference matters: where it was gathered FROM, which `pull` takes, and where it LANDED, which `image` and a run take. `${gather.first}` is the first; `${gather.first.place}` is the second, and says so when a member is not in CUBE yet.

`--pace` waits between lines, for watching a play at a surface. `--dry-run` expands everything and shows the lines without running them. `--step` is refused by name, because a keypress needs a terminal and a daemon has none. A refused line stops the play, naming the file and line, and the play exits non-zero — the second half of a workflow whose first half failed is noise.

Fourth slice of the manifest work (`docs/manifest.adoc`).
