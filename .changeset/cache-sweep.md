---
"@fnndsc/salsa": patch
"@fnndsc/cumin": patch
"@fnndsc/brasa": patch
"@fnndsc/argus": patch
---

Listing /proc/jobs and entering a feed no longer wait on CUBE: the roster check runs behind the answer after 250 ms. A session booted from a door's token keeps its folder lookups memoised, as a password boot always did; a lookup that finds no folder (a shared feed's own path) is kept 15 seconds instead of asked again by every caller; `ls` reads a listing once; a parent's fresh listing answers whether a child is a folder; the PACS server list is kept a minute. The terminal console's text is the transcript's size again.
