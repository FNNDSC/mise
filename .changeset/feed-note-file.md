---
"@fnndsc/salsa": minor
"@fnndsc/brasa": minor
---

A feed's note is a file (#831, slice 1b): `/proc/jobs/feed_N/note` lists beside `status` and `title`, `cat` reads it and `touch --withContents` writes it whole (its title stands), and `edit /proc/jobs/feed_N/note` opens it in the surface's editor and saves it back through the projection — a projected file is never uploaded into CUBE's store. `feed note edit` now edits through the surface's editor seam (`localEdit`) instead of spawning `$EDITOR` itself, so a browser surface can offer its own editor; a surface without one refuses by name. Fixed on the way: an empty `# Title:` line no longer takes the note's first line as its title.
