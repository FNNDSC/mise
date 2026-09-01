---
"@fnndsc/brasa": patch
"@fnndsc/salsa": patch
---

`ls` on a ChRIS link (`~/public`, `~/shared`) follows the link instead of rendering the link entry itself: the parent-cache leaf shortcut no longer captures links, so resolution falls through to the dispatcher's PathMapper. Native listings are also name-deduplicated (CUBE's links search can return the same row twice, observed on /PUBLIC).
