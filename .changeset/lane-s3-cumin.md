---
"@fnndsc/cumin": minor
---

feat(cumin): `listPages_walkWindowed` — the one pagination loop, windowed: the first page alone to learn the total, then up to N pages in flight, each yielded as it lands; sequential when the server reports no total; a failing page ends the walk once the window settles
