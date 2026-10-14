---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
"@fnndsc/argus": patch
---

A feed shared to you is seen on your next look at the roster, not after the next ten-minute walk (#1058). The roster's delta reads each collection's newest page and walks whole when the total moved, so a share, an unshare or a deletion lands on the visit that follows it. `proc feeds <q>` matches a feed's title, its `feed_N` name and its id; a bare id the roster lacks is asked of CUBE live and adopted, or refused with why (not shared with you, or shared to a group you are not in). `ls /proc/jobs/feed_N` asks the same way. In ARGUS a RUNS filter that names a feed by id and matches nothing asks the session too: the row arrives marked, or the field says what CUBE answered. The roster frame gains REFRESH (`proc feeds --fresh`), and the bar says `CHECKING CUBE FOR THE FEED LIST…` while any walk runs and `FEED LIST CURRENT · n NEW` when it lands.
