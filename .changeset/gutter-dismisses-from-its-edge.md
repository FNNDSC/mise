---
"@fnndsc/argus": patch
---

The left body gutter now dismisses the way the header does. A press on the domain already shown (FILES while in files, PACS while in pacs) slides the gutter off stage left and hands its width to the workspace — a focus of the whole field, distinct from a single-pane zoom. A press that navigates still lands deterministically in that domain (the gutter law holds); only a press on the current domain carries the dismissal. The state (`data-gutter='away'`) is orthogonal to the header and to zoom, so header-away, gutter-away, or both (a full-bleed wall of panes) compose, each restored from its own edge. A pulsing left strip or Esc restores the gutter; Esc peels one layer per press — zoom, then gutter, then header. Not persisted across a reload.
