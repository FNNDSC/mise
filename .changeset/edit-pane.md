---
"@fnndsc/argus": minor
"@fnndsc/brasa": patch
---

ARGUS edits a file in a pane (#831, slice 3). The kernel's `edit <file>` (and `feed note edit N`) opens an EDIT pane beside the focused one: CodeMirror 6 as a guest field, loaded on demand and painted from the theme's tokens; SAVE and REVERT on the mode frame, lit only while the field differs from the file; the bar says DIRTY or SAVED; Ctrl-S saves and Esc gives the keyboard back. Every save is the line the operator could have typed, `touch --withContents='<text>' '<path>'`, echoed and run, so the transcript holds each save and a feed's note is written through its projection. A second `edit` of the same file finds its pane and keeps unsaved changes; a desktop card brings the pane back on its file. brasa fixes found on the way: the semicolon splitter honours a backslash escape (an escaped quote no longer ends the quoting, so a later `;` inside it no longer splits the line), and an empty value is a value (`--withContents ''` writes an empty file instead of touching the empty word as a path).
