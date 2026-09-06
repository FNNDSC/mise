---
"@fnndsc/cumin": minor
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
---

feat: a plugin is data — the manual becomes a projection of the model

A plugin's substance existed only as text. `cat /bin/<entry>` fetched the plugin, formatted a manual, and that manual was the whole of what any surface could have — a paragraph nothing downstream can act on: not a card, not a parameter list, not a form, not an export.

The kernel now builds the model first and renders the manual from it. `plugin info pl-dcm2niix-v2.0.0` answers with a `plugin.info` model carrying identity, the authoring facts, and every declared parameter; `cat /bin/pl-dcm2niix-v2.0.0` prints exactly the text it printed before, now as one projection of that model rather than a second independent scrape that can drift from it.

**Parameters carry the flag as it is typed.** A plugin's own `flag` when it declares one, `--name` otherwise — a form built from the name alone would spell `--inputFile` where the plugin wants `-i`.

**The parameter list is drained to exhaustion.** `getPluginParameters({ limit: 100 })` was one of the silent truncations catalogued in #401: a plugin declaring more lost the tail and said nothing about it. `pluginParameters_drain` walks to the end, and a live exemplar checks the model's count against the count CUBE itself reports — a client that both fetches and counts can agree with itself while being wrong.

cumin gains `plugin_find` and `pluginParameters_drain` on the typed contract, so the `/bin` reader no longer reaches past it to the raw client.

No surface change: this is the wire fact a plugin's one-node graph will read.
