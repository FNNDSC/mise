---
"@fnndsc/brasa": patch
---

Searching tags, groups, workflows, plugin metas or jobs by a term works again (#1237). `<resource> search <term>` used to read the term as a subcommand and refuse it (`Unknown subcommand: feed_id:5536`). The other options on the line now carry into the listing, and a search with no term or more than one is refused by name.

A resource `list` refuses an option it does not read instead of printing the unfiltered first page: `jobs list --feed 5536` answers `jobs list: unrecognized option '--feed'; filter with --search <field>:<value>`. The options it reads are the standard ones its help lists (`--all`, `--limit`, `--fields`, `--sort`, `--reverse`, `--search`, `--table`, `--csv`, plus `--page` and `--offset`).

The help for `plugininstance` (and `job`, `jobs`, `instance`, `instances`) no longer lists `cancel`, `delete`, `output` and `parameters`, which were never implemented. A job is worked in `/proc/jobs`: `proc find <id>` names its path, `rm` on it cancels or removes it, and its `params`, `log` and `data` live under it. Typing one of the old verbs says so.
