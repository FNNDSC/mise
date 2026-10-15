---
"@fnndsc/argus": patch
---

A view can be sent as a link or a file, and opening one is safe. SHARE VIEW's COPY LINK gives a link that opens ARGUS on the same view, and `desktop load <file>` opens one kept in ChRIS. A received view shows its lines and asks before running, runs only view commands (never `rm` or anything else in your session), changes your graph settings for that visit only, and says where it stopped if it cannot finish. FILES panes now record their folder too (`file open <folder>`).
