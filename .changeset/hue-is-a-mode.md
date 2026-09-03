---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
---

The process cache records the compute resource each plugin instance ran on (from the CUBE list row), and the `feed.dag` model carries it per node (`mixed` for a group whose members ran on different resources), so a surface can hue a graph by where its work ran.
