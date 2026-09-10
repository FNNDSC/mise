---
"@fnndsc/calypso": patch
---

The daemon now tells a browser how long it may keep what it serves. It sent a content type and nothing else, and silence is not neutral: with no `cache-control`, no `etag` and no `last-modified` a browser may keep the page, and `index.html` is the file that names the hashed assets — so a kept copy pinned the whole surface to the build that wrote it and no rebuild ever arrived. `index.html` is `no-store`, a hashed asset is immutable for a year since a different build is a different URL, and anything else revalidates.
