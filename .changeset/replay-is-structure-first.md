---
"@fnndsc/argus": patch
---

Desktop restore replayed its action log one pane at a time and waited for each viewer's series to finish loading before opening the next — a whole desktop took as many seconds as its viewers' loads laid end to end. Replay is structure-first now: each open hands back its pane id synchronously (a new `onOpen` on `image_open`), the whole arrangement is built in one pass, and the slow parts (a series' header read, a query) load in parallel behind the frames. The `wait_until` polling and fixed `sleep`s are gone; saved view state lands on the viewer's own completion; the domain switch calls `domain_enter` directly (synchronous) so its orphan sweep can't dispose the panes opened after it. A viewer-plus-browser desktop's frames now return in ~90-250 ms (were seconds), geometry unchanged. This is also the substrate the shared-session collaboration layer needs.
