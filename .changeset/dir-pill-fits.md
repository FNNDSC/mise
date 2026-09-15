---
"@fnndsc/argus": patch
---

The DIR verb widened a PACS series row to three capsules (GATHER, IMAGE, DIR) where the action track was sized for two, so DIR clipped at the pane edge. The series action track grows from 12em to 16em, which the three capsules clear with room. Fixed track, so every series row reserves the same width and the caps stay aligned.
