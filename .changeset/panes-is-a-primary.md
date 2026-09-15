---
"@fnndsc/argus": patch
---

PANES-06 came up empty after navigating between domains. The gutter's original domains (files, dag, pacs) are primaries the orphan sweep spares so a domain switch never disposes them; PANES was added as a domain but omitted from that list, so moving to RUNS or FILES disposed the PANES pane itself and the card grid was gone on return. PANES now joins the spared primaries. A smoke scenario guards it: move away to RUNS, open PANES, assert the group is a card and restores on press.
