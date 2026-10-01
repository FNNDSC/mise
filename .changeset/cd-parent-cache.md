---
"@fnndsc/brasa": patch
---

`cd` reads the parent from the listing cache before asking CUBE: every `cd` listed the parent from CUBE (three requests) to learn whether the entry was a link, though the parent was the listing on screen.
