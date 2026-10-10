---
"@fnndsc/calypso": minor
"@fnndsc/chell": patch
---

Nothing changes in the browser: calypso no longer depends on ARGUS, and the launcher passes the web root (#984). `daemon_launch` takes `webRoot`; `CALYPSO_WEB_ROOT`, a bundle under the working directory and the enclosing checkout still come first. chell depends on `@fnndsc/argus` and passes the bundle it ships (porter launches through chell). The `calypso` command still defaults to ARGUS when it is installed beside it. `packageWebRoot_find(name, from)` finds the bundle any installed package ships.
