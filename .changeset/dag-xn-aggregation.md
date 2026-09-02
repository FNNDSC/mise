---
"@fnndsc/brasa": minor
---

The `feed.dag` wire model is now the COLLAPSED projection: isomorphic sibling subtrees merge into one ×N node (the terminal tree's own collapse transform), so a massive fan-out crosses the wire and reaches a rendering surface as its shape, not its census. Each collapsed node keeps a real representative instance (id and data address), wears its worst member's status (an error anywhere in the group is visible on the node that stands for it), sums member metrics, and carries a tally with jump-to-error anomaly ids.
