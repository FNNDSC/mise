---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
"@fnndsc/chili": patch
---

Deletion works from any context. `rm` no longer depends on the session's
current directory or a prior listing: `files_delete` anchors at the target's
parent folder and loads its collection itself, and chili's `rm` passes that
parent explicitly. New path-addressed deletion API: cumin
`folder_deleteByPath` and salsa `folderByPath_delete`, which return only
once the CUBE confirms the folder no longer resolves. Context writes are
ordered after session-filename resolution, fixing a fresh session's first
`cd` intermittently losing its value.
