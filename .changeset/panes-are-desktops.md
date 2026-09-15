---
"@fnndsc/argus": minor
---

PANES is now a desktop switcher: a card is a whole ARRANGEMENT, not a single image. Restoring a card brings back the domain and its tiles as they were — a PACS query beside its viewer, not the viewer beside a stray files browser. A desktop is captured as a REPLAY of console actions (`view pacs`, `pacs query …`, `image <path>`, `image layout mpr`, `image tags`) at a single `domain_enter` chokepoint every gutter domain routes through, before the preset switches, so no context is lost. Replaying rebuilds the arrangement because each `image <path>` splits itself beside its domain exactly as it did live. Cards are keyed by the on-stage viewer's series (deduped — returning updates the one card); this unifies with the existing `desktop` feature (a card is a desktop; `desktop save <name>` pins one). The narrow-PACS clip is fixed in rendering — the workspace scrolls both axes rather than clip a verb — and replay inherits it.
