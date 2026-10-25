---
"@fnndsc/argus": minor
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
"@fnndsc/porter": minor
---

A PULL in ARGUS runs in the background: the console and every other press stay yours while a retrieve goes on. The press sends `pull … &`; the badges follow it as before, each running joblet is a row on the LANE instrument with a STOP that types `kill %N`, the console prints when one starts, ends or waits for an answer, and RESTART names the joblets it would end (#1273).

A joblet relays its progress, and any model it answers with, to the surface it came from; its task carries its progress. The heartbeat's lane lists the running joblets, calypso answers `GET /joblets` (token-gated), and a porter login that finds a session on older code keeps it, rather than restart it, while joblets run.
