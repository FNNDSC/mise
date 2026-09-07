---
"@fnndsc/cumin": minor
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
---

fix: a listing shows what is there — no silent page limits

`ls /net/pacs/queries` answered with 100 of 1,817 stored queries and said nothing about the other 1,717. That was one symptom of a pattern: callers reaching a single-page list call with a literal limit and returning the page as though it were the collection.

**The default is now the collection.** A caller that names no limit gets a walk to exhaustion, not the first twenty. A caller that names one gets exactly that page, marked `incomplete` with what it is showing of what exists — a bound the surface can state rather than a truncation nobody sees.

**A walk that stops says where.** CUBE fails some collection queries past an offset (measured: `userfiles` answers to offset 800 and returns 500 at 1000). The walk keeps what it gathered and reports where it stopped, rather than handing back a prefix that reads as an ending. A walk whose *first* page fails is still a failure, since a listing that never started is not a short listing.

**Three callers fixed:**

* `pacs status` searched the first 200 queries for a matching expression, so anything older answered "not found". It walks now — verified live against a log of 1,897, finding query 3.
* `getfacl` read a feed's first 100 grants. A hundredth name is not a natural place for that answer to stop.
* A `ts` node's join edges are read from its parameters, which were fetched one page deep. A node with more parameters than a page silently lost its edges — a graph drawn short.

**And a gate**, `npm run lint:listings`, in CI: a literal `limit` above one reaching a single-page list call fails the build unless the line says `listing-bound:` and why. Two bounds are declared today; both are exact-path lookups, not collections.
