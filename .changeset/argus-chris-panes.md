---
"@fnndsc/argus": patch
---

Nothing changes on screen: RUNS and the universe are built by the ChRIS composition, not the frame (#985). Their builders move to `compositions/chris/panes.ts`, made from a context the frame hands in. The frame's DOM helpers move to `frame/dom.ts`.
