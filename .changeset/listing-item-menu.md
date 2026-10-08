---
"@fnndsc/menu": minor
"@fnndsc/fond": patch
"@fnndsc/chili": patch
"@fnndsc/brasa": patch
"@fnndsc/chell": patch
---

Nothing changes for chell, ARGUS or porter users: a listing entry's shape now belongs to menu, with an open type. `ListingItem` and `listingItemSchema` are menu's, so a backend can list its own kinds beside `dir`, `file`, `link` and `vfs`; fond's `VFSItem.type` opens the same way, and chili re-exports the type.
