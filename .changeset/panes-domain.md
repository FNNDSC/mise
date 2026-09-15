---
"@fnndsc/argus": minor
---

PANES-06: the groups you moved away from, as cards to bring back. The inert COMPUTE-06 gutter slot is now a full-workspace domain that draws the dormant set as a grid of cards — one per group, with the viewer's thumbnail, a label from the anchor, and a badge per member. Pressing a card restores the whole group onto the stage at its saved view state (layout, slice, window/level, colormap, ghost) and reopens its tags member; the small DISMISS forgets it. Opening PANES sends the current group dormant (free and recoverable — it becomes a card too). It is a domain, not a floating overlay, keeping the gutter's one interaction grammar. This is the visible face of pane-group restoration; the scrollback-replay interaction on reattach remains to be reconciled.
