---
"@fnndsc/chell": patch
---

Coming through a door, `chell --remote --door` shows the session's boot rows as they happen. The client read the boot stream whole, so it waited for the door to close it and printed a minute of rows in one lump after "the boot as it happens:" had promised otherwise.
