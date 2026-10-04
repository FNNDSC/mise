---
"@fnndsc/argus": patch
---

GATHER no longer fails silently. A cohort holding a gathered place (from the console's `gather add <dir>`) has no description, and the listing façade threw on that empty cell, taking every later GATHER down with no notice; the façade now draws a missing fact as empty text, and a gathered place reads as its path. The PACS query form's study terms (DATE, ACCESSION, MODALITY, SERVER) now stand over their caps; the form ended 68 px wider than the study rows.
