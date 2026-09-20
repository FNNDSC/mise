---
"@fnndsc/argus": patch
---

ARGUS: the PACS field fills its pane.

A PACS answer stopped a third of the way down a full-height pane, rows cut mid-line and black beneath: `.pacs-listing` was capped at `34vh` — a cap on the viewport, from the day the PACS workspace stood in the header row above a console and had to leave it room. As a body tile the cap outlived its reason. The field now takes whatever its pane leaves it and scrolls within that, as every other tabular pane's field already did.
