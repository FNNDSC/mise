---
'@fnndsc/argus': patch
---

The TD controller and trek's bridge are drawn in the ARGUS frame: the same gutter, elbows, bands and strips as the page. Each had drawn a frame of its own, a hundred pixels wider in the gutter, with its head and body elbows touching and its body opening on bare text; now one frame (`features/takeover/frame.ts`) serves every screen that takes over, built on argus.css's own rules so the two cannot drift again (#1285).
