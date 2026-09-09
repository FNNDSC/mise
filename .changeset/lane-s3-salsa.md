---
"@fnndsc/salsa": minor
---

feat(salsa): a feed's topology walk fetches four pages at once (`FEED_WALK_IN_FLIGHT`), so a 58,760-node feed that walked for 28 minutes sequentially on a 2.8 s/page CUBE lands in about a quarter of that; the global sweep keeps its sequential, resumable loop
