---
"@fnndsc/argus": minor
"@fnndsc/brasa": patch
---

ARGUS and kernel: the gather gesture is reachable, and an exported table is visible where it landed.

Three faults found by running the operator's own flow against a live PACS.

**GATHER SHOWN was invisible.** It was put on the results mode frame, which is the closed spine at rest: measured live, 22px wide and `visibility: hidden`. It now stands beside EXPORT CSV on the command row, where the verbs that act on the whole answer already live.

**GATHER was offered only once a series was home**, so on a fresh answer, where nothing is home, the gesture did not exist. A cohort is a set of targets and the feed it roots is made by a pull over its members, so a series is gatherable once it can be named: a PACS path, or the fact that it has landed. Query, filter, take what matched, fetch it as a set. PULL still means bring this one now.

**The export was not broken; the listing was stale.** The CSV writer wrote straight to CUBE and never invalidated the folder's cached listing, which every other fs verb does — so `cat` returned the file while `ls` and every browser showed the folder without it. The write now invalidates the folder it wrote into, and the one that shows a folder it had to create. The WROTE readout also opens that folder when pressed.
