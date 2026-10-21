---
"@fnndsc/menu": minor
---

The prompt context gains backend-neutral segments a backend fills in order and a surface draws in order.

Each segment is a key, a label, a value and a tone.

A ChRIS daemon sends none and its prompt is unchanged; an older surface ignores them. The tones are leader, place, identity, path, work, note and alert; a surface maps each to its own palette, so no colour crosses the wire (docs/stratus.adoc, D9). Beside the brain, `@fnndsc/menu/logo/td` renders the Trusted Domain mark, the blue North Star in the driver's ring, for the stratus composition's splash.
