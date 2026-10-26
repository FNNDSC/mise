---
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/chili": patch
---

A read runs while another line works: `ls` in a browser comes back while a PACS pull runs in a console. Each command says what it changes of the session, and calypso runs lines side by side unless they change the same piece: a read holds nothing, `cd` holds the working directory, `gather` the cohort, and a command that has not said holds the whole session, so it waits and is waited for as before (#1273).

Each line keeps its own slot in calypso (its surface, its questions, its STOP) and in the kernel (its cancellation, a played manifest's depth and recorder mute, and the directory it stands in, read once when it first asks), so the per-command hand-over a question used to need (`turn_leave`, `turn_resume`, `turn_abort`) is gone; a STOP names the line it reaches. `tree` and `du` scan a named folder where it stands (chili's `scan_do` takes a `folder`) instead of moving the shared directory there and back.
