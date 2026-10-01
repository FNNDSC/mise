---
"@fnndsc/orrery": patch
"@fnndsc/argus": patch
---

In the 2D projection a node's disc is drawn on its tubes, not under them: the disc draws after the tubes without the depth test, as a sphere's near hemisphere covers a tube end in 3D.
