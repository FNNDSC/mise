---
'@fnndsc/brasa': patch
---

The `pacs.query` model now says what CUBE already holds: each series carries
a `pulled` flag and file count (one bounded sweep of single-attempt lookups),
and studies carry their own VFS path so a surface can pull a whole study.
