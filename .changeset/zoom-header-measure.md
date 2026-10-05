---
"@fnndsc/argus": patch
---

Zooming the console (or any pane) after leaving the dashboard takes the whole page again: the header's height was measured mid-glide and the zoom slid it only a few pixels. And FILES-02 brings the files back after KEYS was opened from the dashboard (it used to think it was already home and fold the gutter away).
