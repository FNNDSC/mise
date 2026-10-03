---
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
"@fnndsc/argus": minor
---

A text file offers EDIT (#831, slice 3b). A file row whose extension is not on the binary list offers EDIT in ARGUS, a feed's note seen through `/proc` included; it runs `edit '<path>'` as a visible line and the kernel opens the editor pane, asking first for a file of a megabyte or more. The binary list moved into the contract package (`EDIT_BINARY_EXTENSIONS`, `path_isEditable`, `EDIT_CONFIRM_BYTES` in @fnndsc/menu), read by the kernel's `edit` for its refusal and by the surface for its offer, so the two cannot disagree. `feed note edit` help now says it edits in the surface's editor. New `docs/cube-feed-coverage.adoc`: each part of a CUBE feed, the kernel verb or path that reaches it, and the known gaps (rename, group permissions, revoking a grant, making a feed private again).
