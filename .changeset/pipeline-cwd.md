---
"@fnndsc/brasa": patch
---

A pipeline now runs from the feed node you are in, as a plugin does (#1263). `cd ${FEED.path}` and then a pipeline from `/bin`, or `pipeline run <name>`, with no `--previous`, starts from the deepest `pl-*_ID` on the working directory's path, from the node itself or from inside its `data` folder. It used to read a saved plugin context that `cd` never sets, so the line was refused with "no plugin instance in context". Outside a feed node it is refused by name: cd into a feed node, or give `--previous <id>`.
