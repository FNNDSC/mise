---
"@fnndsc/fond": minor
"@fnndsc/chili": patch
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: `ls` renders through fond, not chili, in every listing exactly as before (#1001). fond gains `grid_render`, `long_render`, `size_format` and `listingItems_sort`, and a listing look: the core's kinds (file, folder, link, mount) plus a backend's, each with its long-view mark, and how a name is coloured. Its one dependency is `chalk`. chili's `ls` views wrap fond with the ChRIS look: plugins, pipelines, and jobs with their status column, coloured by the colour configuration. brasa's listings render with the installed backend's look, or plainly when it has none. `VFSItem` gains `tags`.
