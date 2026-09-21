---
"@fnndsc/argus": patch
---

ARGUS: CLEAR asks before it throws a cohort away.

Once cleared, a cohort is gone. So CLEAR on a cohort that has changed since it was last SAVEd asks on the band — "Save the cohort first?" — YES saves and then clears, NO clears, Esc leaves everything standing; a name abandoned inside the save abandons the clear too. A cohort already saved clears without a word. The session's working file is not a save; a cohort never named is unsaved.
