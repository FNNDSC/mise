---
"@fnndsc/salsa": patch
---

Reading a feed's data costs its first page, not its whole folder: the reader lists the first fifty folders, files and links of a level, reads a DICOM header from the first 2 MB of a file (the parse stopping at the pixel data), passes over XML reports, tries a few UID-named files as DICOM, and says when a feed's data lives somewhere this identity may not read.
