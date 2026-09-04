---
"argus": patch
---

fix(argus): runs-02 gets the same frame treatment, and 02-CALYPSO matches ARGUS WEB

The runs roster shared one scrolling box with its caps, so its scrollbar ran the full height of the pane and up behind the frame — the same defect the files browser had. The caps now sit above a scrolling field, and the roster shows as a flex column rather than a block.

The version face stops being its own design. It had picked up a private set of overrides — smaller label pills, shrunken fonts, tightened line heights, a bespoke grid — none of which the ARGUS WEB face uses. They are gone. It now uses the same three-column idiom, the same type and the same pill width, verified against a live daemon: both faces report three columns, a 15.4px label, a 19.8px value and a 209px pill. The cycler gives back the width to make room, from two fifths of the band to under a third.

One structural correction stays: the columns belong on the readout, not on the face. The rows live inside an `about-rows` wrapper, so columns set a level above it fragment the wrapper rather than its rows, which left every row in the first column and the rest of the band empty.

Values still elide rather than wrap, so a long git hash or build date cannot disturb the layout, with the whole text on hover.
