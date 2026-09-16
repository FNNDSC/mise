---
"@fnndsc/argus": patch
---

A PACS series row's verbs now carry a persistent lit hue when their result is on this surface's stage: IMAGE lit when a viewer regarding the series is open, DIR when a browser on its folder is, GATHER when the series is in the cohort (PULL stays plain). The state is derived from the live panes (kind + regard address), recomputed on every stage change and toggled on the rendered rows in place, so the listing never re-renders. Because it is derived it is honest across a close and free on restore — the replayed intents recreate the panes, the bus reflects them, the verbs light — so scrolling the series list after a restore traces what was visualised and DIRed. One engaged hue reads across the pills (the deep fill #579 gave a press, now also the persistent selected state), clearing WCAG AA. Scoped to the local surface.
