---
"@fnndsc/argus": patch
---

Republished with its bundle. Both 0.7.0 and 0.7.1 went to npm carrying two files and no `dist/`, because both were published by hand from a checkout where the bundle had never been built — `dist/` is gitignored, so it exists only where someone has run the build. Neither the `files` field nor npm's ignore-file precedence was ever at fault. This release goes through CI, which builds before it publishes.
