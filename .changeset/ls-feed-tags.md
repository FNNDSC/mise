---
"@fnndsc/cumin": minor
"@fnndsc/chili": minor
"@fnndsc/brasa": minor
---

`ls -l` shows a feed's tags (#831, slice 1c): a long listing that holds feeds (`feed_N` rows, as in `/proc/jobs` or `~/feeds`) prints each feed's tags as `#tags` after its title. The tags come from one map for the whole listing — the user's tags, then each tag's feeds — so a thousand feeds cost as many reads as the user has tags, never one per feed; the map is kept a minute and forgotten whenever a tag is added or removed here. A listing with no feed in it reads nothing.
