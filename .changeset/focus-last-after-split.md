---
"@fnndsc/argus": patch
---

Ctrl-B ; after a split returns to the pane you split from (#1049). The layout gave a split's new pane (and a moved pane) focus without recording the pane that had it, so tmux's last-pane key had nothing to go back to and Space then flipped the wrong pair.
