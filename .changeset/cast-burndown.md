---
"@fnndsc/cumin": minor
"@fnndsc/salsa": patch
"@fnndsc/chili": patch
"@fnndsc/brasa": patch
"@fnndsc/chell": patch
---

Cast burndown to the adapter floor. The wire contract gains the pipelines
surface (`pipeline_get` with piping items and plugin metadata handles,
`pipelineSourceFilesPage_get`); salsa's pipeline modules, feed joins, and
brasa/chili call sites migrate onto typed accessors and honest converters.
The repository's `as unknown as` count is now 2, both inside the licensed
adapter seam, and the CI ratchet holds it there. chell progress bars also
draw on the renderer's configured stream instead of assuming stdout.
