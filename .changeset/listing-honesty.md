---
"@fnndsc/salsa": minor
"@fnndsc/cumin": minor
"@fnndsc/brasa": patch
---

fix: a listing says what it could not read, and cat reports instead of crashing

**A listing that could not read part of itself says so.** `ls` asks a folder for its directories, its files and its links, and a refused sub-listing was being dropped for looking like an empty one — so the home root whose file listing CUBE refuses rendered its folders alone, as though that were everything. The provider now names what it could not read (`Cannot fully list <path>: could not read files (Internal server error)`) and the listing carries that reason with the entries it did get.

**`files_listAll`'s `null` meant three things** — an empty folder, a folder that is not there, and a folder the server would not describe — and nothing above it could behave correctly on one word that means all three. `files_listOutcome` says which: `listing`, `empty`, `missing`, `refused`. `files_listAll` stays as the lossy wrapper, but a refusal now throws rather than passing for absence.

**A file is deleted by its id**, not by finding it in a listing first. The folder whose listing the server refuses is exactly the one an operator needs to clear, and a delete that walks the parent cannot help there. `chrisIO.file_deleteById` is the new door; other asset kinds still resolve through the group.

**`cat` reports an unreadable path instead of ending the session.** A read that threw — a path that cannot be resolved, a server that refuses — escaped as an unhandled rejection that dumped an axios request object, auth header included, and killed the process. Each path is now resolved and read inside its own guard: the failure is reported like any other unreadable file, the rest of the line still runs, and nothing is dumped.
