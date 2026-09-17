---
"@fnndsc/argus": patch
---

ARGUS: the PACS query form's fields are black again, not the browser's white.

Every field of the query form (PATIENT, MRN, DATE, ACCESSION, MODALITY) was drawn as a white box with the frame's own light type on it, which is unreadable. The fields shared one selector list with the gather tray's name field, and removing the tray took the list's second half and the declaration block with it, leaving a dangling `#pacs-form input,` that fused onto the rule below. The fields then had no background, no border and no colour of their own, so they fell back to the browser's defaults; they also picked up that rule's `display: flex` and bottom margin.

The block is restored: black ground, lit border, mono type, and the focus ring the command line beneath them has.
