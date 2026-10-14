---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
"@fnndsc/chili": patch
"@fnndsc/brasa": patch
"@fnndsc/calypso": patch
---

A large file downloads, and a file in a feed shared with you downloads (#1061). A file stream has no 30 s deadline any more: CUBE held a 3.7 GB DICOM's first byte for up to a minute, and the old deadline killed every attempt. A watchdog fails a transfer only after two silent minutes, and says so. A file in a colleague's shared feed is read through CUBE's file browser, which serves it where `/userfiles/` answers 403. `download` names the kernel's reason (a stall, a refusal, a file too large to read whole) instead of "Failed to download file", and a file over 256 MB is never read whole into memory after a failed stream. ARGUS's DOWNLOAD streams through the daemon with its length in the header, so the browser draws its own progress and the daemon holds nothing whole.
