---
"@fnndsc/cumin": minor
"@fnndsc/chell": patch
---

The boot's PACS-query row now reports the amount of queries the index holds, not the one record a resume re-touched. The sweep resumes from the newest query it already has with an inclusive `min_creation_date`, so CUBE hands that boundary record back and the loop counted it — a resume that found nothing new still read `Indexed 1 PACS query`. The sweep now counts only records the index did not already hold (new `QueryIndex.has`), carries the total held in its result, and the boot row reads `1905 PACS queries indexed`, adding `, N new` only when the top-up actually filed some.
