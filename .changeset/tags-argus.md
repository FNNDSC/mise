---
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
"@fnndsc/argus": minor
---

ARGUS shows and changes a feed's tags (#831, slice 4b). The kernel's roster model (`feed.list`) carries each feed's tags from the cached tags index (one read per tag, never per feed). The runs roster marks a feed with its tags after its title, in one theme hue; a press on a mark filters the roster by it (`tag:`, a new filter-only term in the listing façade), and its × on the indicated row takes it off. A feed row offers NOTE (the editor on `/proc/jobs/feed_N/note`) and TAG. TAG asks a new `choose` question: your tags as pills (the worn ones dimmed), a field for a new name, DONE to end; each pick runs `setfattr`, a new name `mkdir /proc/tags/<name>` first, all as visible lines, and the question comes back with the tag held. A graph on stage reads its feed's note and tags when entered and shows ADD NOTE or EDIT NOTE, TAG and the marks under BACK, re-read after an editor save. A note is never read for the roster (CUBE's feed list says nothing about notes: ChRIS_ultron_backEnd#737).
