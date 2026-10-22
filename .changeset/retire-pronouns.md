---
"@fnndsc/brasa": minor
"@fnndsc/chell": minor
---

The recent-state pronouns are gone: a line names what it made with `A=$(…)`, never `${feed}`, `${run}` or `${query}`. `${feed}`, `${run}`, `${run.place}` and `${query}` were filled behind the line by whatever ran last, so one name meant different runs on different lines and a path that forgot to fill one left it stale (#1207); they and `session/recent.ts` are removed. `plugin run` is retired (a plugin runs by its name, where the session stands), and so are `pull --plugin` and `--pipeline` (pull lands data; a run goes over it). `chell -f` and `chell file` play the script as a manifest: each line shown, the first refused line stops it, and the exit is non-zero; `-e` changes nothing for a script. `help pronouns` is now `help variables` (#1208).
