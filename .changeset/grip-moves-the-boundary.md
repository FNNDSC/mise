---
"@fnndsc/argus": patch
---

Dragging a column boundary in a listing now moves that boundary with the pointer, the way a file manager does. The two columns beside it trade the width, within their minimums. Before, a grip widened the column to its left and let NAME absorb the difference, so on a files listing every column grew away from the hand and the NAME | TYPE boundary did nothing. A double-press gives both columns back, and a boundary never moves against the hand.
