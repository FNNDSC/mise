---
"@fnndsc/cumin": minor
"@fnndsc/chell": minor
---

fix(cache): the listing cache's lifetimes stop lying, and the boot row says what it holds

`ttl_get` compared exact paths or a doubly anchored wildcard, so `/home` never covered `/home/<user>/feeds` and `/feeds/*` matched a top-level path this VFS does not have. Two of the four tuned entries did nothing, and everything but `/bin` and `/PUBLIC` silently took the three-minute default. Matching is now longest-prefix on whole segments, so `/bindings` does not inherit `/bin`.

Lifetimes are now split by whether a signal exists rather than guessed per path. Where `/proc` reports movement — `/home`, `/SHARED`, `/PUBLIC` — the clock is a backstop against a missed notification and runs long. Where nothing reports, it stays short. The plugin and pipeline indexes go to a day, because registration is an administrative act on a scale of months and an hourly re-walk was the most aggressive refresh in the table for the least mutable data in the system.

The cache holds 500 path listings rather than 100, and says so the first time it fills: an evicted listing also leaves the checkpoint, so a session that quietly crossed the old cap came back thinner than the one that wrote it.

The boot row `Listings` becomes `Folders` and reports age alongside count. It is the restored folder-listing checkpoint, not the plugin index, which has its own `Plugins` and `Pipelines` rows; and a count with no age says nothing about whether the restore was worth having.

Also records the change-discovery entry in `docs/CUBE-gaps.adoc`: CUBE offers no way to ask what changed, which is why clients invent clocks at all.
