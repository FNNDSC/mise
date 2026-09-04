---
"@fnndsc/cumin": minor
"@fnndsc/chell": minor
---

feat(cache): feed movement dirties the folder listings it touched

`/proc` already learns when a feed arrives, vanishes, or finishes work. The folder-listing cache, in the same process, heard none of it and re-fetched on a clock instead. This is the wire between them.

Two rules govern it. Your own act deletes and someone else's act dirties: a mutation removes the entry, because showing a file you just deleted is incoherent, while a job's output or a colleague's share is not wrong but merely behind, so the entry is marked and served at once while it refreshes behind. And movement coalesces, because a feed completing a fan-out stage lands many terminal transitions in the same second.

Nothing subscribes to the process cache's change stream. That stream fires on every instance add and status observation, so indexing one large feed emits tens of thousands of events, none of which mean a file appeared. Movement is pushed from the three places that actually know: a job crossing into a terminal state, a feed arriving on the roster, and a feed vanishing from it. A merely-running job says nothing, having produced nothing to list.

Feed-to-path mapping needs no new index. `path_extractFeedID` already reads a feed id out of any cached path, so a shared feed under `/SHARED` is reached by the same rule as one under a home folder, with no extra wiring.

An arrival changes the folder a feed appears *in* rather than anything inside it, and the roster speaks only in feed ids, so a host declares those folders once through `rosterParents_set`.
