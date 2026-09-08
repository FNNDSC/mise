---
"@fnndsc/argus": patch
---

fix(argus): the PACS progress bar spans the middle and lines up level over level

The series level was designed with its bar beside the description; the patient level and the reshaped study level then put PROGRESS after every fact, at the far right, each level on a grid of its own — the patient bar began 277 px left of the study's. And the study grid's content-sized tracks (`minmax(0, 13em)`) narrowed per row, so a short name jogged every column after it for that row alone.

At every level the columns now read identity, description, PROGRESS as the one `1fr` expanse, then the trailing facts, then the verbs. Every other track is a fixed length. The four leading tracks are the same widths on the patient and study grids and the series description is widened to meet them, so the bars begin at one x on all three levels; the patient row takes the same font size as its caps, since the tracks are in em. The query form follows the study grid: the provenance readout stands over PROGRESS, the QUERY control in the verbs column.
