---
"@fnndsc/brasa": minor
---

Add `feed tree <feedId>` — renders a feed's plugin-instance DAG as an annotated text
tree. The anchor tree is drawn with box-drawing connectors; topological-join (`ts`) nodes
are annotated inline with the extra sources they merge (`⋈ joins ...`). Supports
`--focus <id>` to scope to a subtree and `--max-nodes <n>` to cap output (0 = all). The
envelope carries a typed `feed.tree` FeedGraph model.
