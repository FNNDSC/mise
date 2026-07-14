---
"@fnndsc/brasa": minor
---

`feed tree` now collapses isomorphic sibling subtrees by default. Structurally-identical
branches merge into one `×N` template node showing a proportional status bar, per-category
counts (`97✓ 2⋯ 1✗`), and the ids of any non-done members (error first) so failures stay
addressable. Collapsed groups use a double-line connector to signal multiplicity. Pass
`--flat` to draw every node individually.
