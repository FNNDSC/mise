---
"@fnndsc/calypso": patch
---

calypso: `/vfs?path=…&download=1` answers the file's bytes as an attachment named for the file (`content-disposition`, the name as ASCII and as UTF-8), so a browser surface can save a file rather than show it.
