---
"@fnndsc/salsa": patch
"@fnndsc/chili": patch
"@fnndsc/brasa": patch
---

A folder and a file never share one path. CUBE lets them, and removing the folder then damages the file's record so every listing of the parent fails (CUBE #732). `mkdir` over a file answers `mkdir: cannot create directory 'X': File exists`, and beneath a file `Not a directory`. `touch` or a write over a folder answers `Is a directory`. `mv` onto anything that already holds the destination refuses (`Destination exists`). `cp -r` skips a file whose name a folder holds, with a warning. `rm` refuses a path that a folder and a file already share, removing neither. salsa's `pathHolders_find` names what holds a path.
