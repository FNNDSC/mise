---
"@fnndsc/argus": patch
---

The published package carries its bundle. `@fnndsc/argus@0.7.0` went to npm with two files and no `dist/`: with no `.npmignore`, npm falls back to `.gitignore` when deciding what a tarball carries, and this app's `.gitignore` lists `dist/` — the very thing the package exists to ship. An `.npmignore` now stops that fallback, so `files: ["dist"]` is the only thing deciding. The tarball goes from 2 files to 46, and a daemon that resolves the installed package finds an `index.html` to serve.
