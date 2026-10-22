---
"@fnndsc/chell": patch
---

The docs say one thing about scripts: a script is a manifest, played by `play`, stopping at its first refused line. `execution.adoc` is now about invoking chell and points at `docs/manifest.adoc` for the language; the retired `pull --plugin`/`--pipeline` and `plugin run` are gone from the README, glossary, command reference and PACS design, which point at `gather process`; `pluginrun.adoc` says a run waits, how to name it with `A=$(…)`, and absorbs the old implementation summary; `posix.adoc` describes variables, the unified expander and what stays non-POSIX (#1208).
