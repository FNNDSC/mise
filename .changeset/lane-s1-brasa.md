---
"@fnndsc/brasa": minor
---

feat(brasa): `feed diagram`, `feed tree`, wire `feed.dag` and `proc refresh <feed>` answer at once with `feed.indexing` when the feed is cold; a feed watch holds the floor while its topology is indexing, never settles on an empty topology, and is kicked by the cache the moment the walk lands
