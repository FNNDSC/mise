---
"@fnndsc/argus": patch
---

Nothing changes on screen: every route from a result to its pane is one table the session's composition fills (#985). `frame/modelRouter.ts` holds the routes per channel, the claims an empty pane answers, and the watch listeners. The ChRIS composition installs RUNS, the universe, PACS, and DICOM images and tags (`compositions/chris/routes.ts`); the frame routes only listings and its own panes.
