---
"@fnndsc/cumin": patch
---

A /proc checkpoint with one torn feed shard restores every other feed instead of being refused whole. A shard whose graph does not stand on its own (an instance naming a parent or join parent the shard does not hold, a twin, a stray, a cycle) is left out and named; its feed stays in the roster with no topology and is walked again. On titan one such shard, 475 of a feed's 477 instances, refused 210,010 instances and a restarted session booted cold.
