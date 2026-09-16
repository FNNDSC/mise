---
"@fnndsc/argus": patch
---

Pressing a PACS series-row verb jogged the whole row sideways and moved the capsule. Gathering a series grows the cohort tray, which shares the pane's height with the listing, so the listing lost height, its field gained or lost a scrollbar, and every row and verb shifted by the scrollbar's width. Now the PACS workspace reserves the scrollbar gutter whether or not it shows (`scrollbar-gutter: stable`), the cohort tray scrolls within a bounded height instead of stealing the listing's, and a pressed capsule reads as a press in place — it darkens to a deep hue, changing only its fill, never a dimension that would reflow the row.
