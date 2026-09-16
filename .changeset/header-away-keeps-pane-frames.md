---
"@fnndsc/argus": patch
---

With the header dismissed and the console closed, both panes lost their top load-carrying frames off the top of the page. Header-away reclaimed the header's space with a negative margin sized to the header's height; in the flex column that pull amplified (a -368px margin dragged the workspace ~500px) and, with the console closed so the workspace already sat near the top, overshot past the top edge and carried the pane frames with it. The header now leaves the flow when dismissed — taken absolute and glided off the top by its own height — so the workspace flows up to fill the top exactly, console open or closed. Same family as the zoomed-pane-frame fix, one layer out.
