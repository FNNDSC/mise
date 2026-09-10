---
"@fnndsc/brasa": patch
---

`rm` treats an abandoned question as an answer, not a failure. A confirmation that comes back with no answer — the operator pressed Esc, or the surface lost its ability to ask — used to abort the per-file `-i` walk with `rm: cannot remove '<path>'`, an error over a file nothing had touched, and left every file behind it silently unoffered. It now skips that file by name, says why, stops asking, and says how many it left alone. The one-question `-I` path keeps everything as before and now states the reason too, so a surface that has quietly lost its voice is not reported as an operator who declined.
