---
"@fnndsc/argus": patch
---

The layout tree learns to move a pane: `leaf_move(pane, side)` detaches the pane and re-splits the nearest block on that side (the former sibling when none), opening even; the only pane on stage and a pane already at that edge are refused by name. The drawer's MOVE pill and the `pane move` verb follow.
