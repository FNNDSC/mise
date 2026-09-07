---
"@fnndsc/argus": minor
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
---

feat: a verb that acts on the place rides the frame — MKDIR and UPLOAD

Two verbs act on the PLACE the field holds rather than on any row, so they ride the field's own frame beside HOME and BACK, and they appear on a browser's frame and nowhere else — there is no directory to make in a list of feeds.

**MKDIR** asks for a name in the console and makes it where the field points, not where the session's cwd happens to be: a rooted browser is showing a place of its own, and a verb that acted on the session's place instead would make the folder somewhere the operator is not looking.

**UPLOAD** is the verb this surface could not previously speak at all. `upload` reaches the daemon's disk, which a browser has never seen. So the operator's own picker chooses the file, and the bytes travel over the daemon's `/vfs` route — now answering `POST` as well as `GET` — where the **engine** writes them through the kernel. No surface talks to CUBE, the same attach token gates the write as gates the read, and the body is capped. The console keeps the account, because a gesture the surface performs itself still owes the transcript what it did.

New seam: `Engine.file_write(path, bytes)`, the twin of `file_read`. It writes through salsa's own create and **invalidates the listing it changed**, as every writing builtin does — without that the browser asks for the folder again and is served the folder as it was before the delivery, which reads as an upload that silently did nothing.
