---
"@fnndsc/argus": patch
---

A file browser opened in a narrow split, resolving a long CFS path, could shove the whole body to the right — the viewer's frame off the edge, the header notch out of line. Three boxes carried `min-height: 0` but not `min-width: 0` (`.files-panel`, `#pacs-workspace`, and the sticky `.files-path` breadcrumb), so a wide child (a CFS path is a long, mostly unbreakable token) could set a min-content floor wider than the pane and push the row. Each now carries `min-width: 0`, and the breadcrumb wraps within the pane rather than establishing a floor. A pane's content scrolls or wraps inside the pane; it never resizes the layout.
