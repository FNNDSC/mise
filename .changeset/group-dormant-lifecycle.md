---
"@fnndsc/argus": minor
---

A link group that leaves the stage is now dormant, not destroyed. A gutter domain switch disposed every non-primary pane permanently, which is the "lost panes" defect — nothing to return to. The orphan sweep now first snapshots each leaving group into a dormant set (`app/dormant.ts`): the series or volume it regarded (its stable id), the image view state (layout, slice, window/level, colormap, ghost — now exposed through `state_get`), the member kinds, and a viewer thumbnail. The set is LRU-capped (24), forgotten only by an explicit dismiss, and persisted to the surface's localStorage, rehydrated dormant on reload. No visible surface yet; the PANES-06 domain that shows and restores these follows in the next slice.
