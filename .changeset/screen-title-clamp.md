---
'@fnndsc/chili': patch
---

Fix titled tables narrower than their title: negative padding computations threw a RangeError that replaced the entire table with "Error generating table". Title width now clamps, truncating gracefully at any table width.
