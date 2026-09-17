---
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
---

A file under a `/proc` projection can be read. The proc provider resolved a node's `data` to the CFS file behind it and then handed that file back to the dispatcher, whose default provider is the host filesystem — which refused it; it now reads the target through `fileContent_get`, the door that knows both worlds. The engine's `file_read` (the daemon's `/vfs` route) resolves the path it is given, so a surface can read a file at the address the session uses for it.
