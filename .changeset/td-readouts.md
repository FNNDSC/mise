---
"@fnndsc/menu": minor
"@fnndsc/stratus": minor
---

A domain now says everything the TD controller draws: where it stands in one word, what it costs, what is refused on it. `domain status` answers each domain with its condition (SIZING, ASKING, BUILDING, UP, SERVING, FAILED, GONE), whether it bills, whether it was built here, adopted or read from a checkout, what is refused on it and why, its spec, each step with its times, the build's running task, the last plan counted with drift apart, and the last verify check by check. `domain build` shows its domain as a `stratus.domain.state` event at its start, on each line it logs, and before each question. `domain size [--family F]` reads what a new domain is sized against: each zone's free cores and memory, the family's shape and price, and the starting spec. `domain verify` keeps its checks beside the plan, and `domain <name>` reads that one domain.
