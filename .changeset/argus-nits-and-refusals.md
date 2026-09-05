---
"@fnndsc/cumin": patch
---

fix: a refused read says so, and the header stops wasting the space it takes

**A file you may list is not always a file you may read.** CUBE lists the contents of a shared feed but refuses the bytes, answering 403 for a file whose size the same identity can see. mise reported that as "not found (404) or access denied (403)" — two opposite answers in one sentence — and the client returns null for a refusal as readily as for an absence, so no status reached the message at all. On the failure path only, the real status is now asked for and reported: a refusal names itself and says what it means.

**argus swallowed it.** The viewer joined the rendered text of a failed read, which is empty, and drew a blank pane — indistinguishable from an empty file. A refused read now opens as `READ REFUSED` with the session's own words, and the row is remembered: it dims, strikes through, and carries a slashed-circle glyph explaining that it is listed but not readable. This is reactive by necessity, since a listing does not say what may be read.

**The file browser's frame is not part of its scroll.** The caps and filter strip shared the scrolling box with the rows, so the scrollbar ran the full height of the pane, up behind the frame, and the sticky frame had to paint over whatever passed beneath it — which is what covered the first row's trailing cell. The frame now sits above a scrolling field, so the scrollbar begins at the frame's lower border.

**The header used one column of two.** The version rows live inside a wrapper, so a two-column grid on the face made that wrapper the single grid item: ten rows stacked in the first track while the second sat empty. The grid moved onto the readout itself. Measured against a live daemon, the band falls from 246px to 199px (19% to 15.3% of viewport), both columns are used, no value wraps or elides, and the attribution is inside the fold instead of clipped.

**Preview cards take the wheel**, on both axes, with scroll chaining contained, and hold 4000 bytes rather than 600 so there is something behind the gesture.

**MEDICAL** replaces SICKBAY as the scheme's name and is the scheme a browser that has never chosen one starts in. A remembered `sickbay` choice maps forward rather than being lost.
