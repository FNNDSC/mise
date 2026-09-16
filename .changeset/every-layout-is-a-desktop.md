---
"@fnndsc/argus": patch
---

PANES-06 only stored desktops that contained a viewer: a layout of file browsers, or a runs layout, left nothing behind, because capture keyed the card on an anchor taken from the first image tile and skipped when there was none. A desktop is any arrangement with content beyond the bare domain now (a single primary pane is still not carded — it is one gutter press away). A viewer desktop stays keyed by its series; a viewer-less one is keyed by the set of content it holds, labelled by its folder or `FILES · N panes`. Verified live: a two-browser files layout leaves a card that restores both browsers.
