---
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/menu": patch
---

Each surface keeps its own last answer, so `@3` counts the listing that surface read. A listing read in a browser no longer renumbers the rows a console is about to act on: calypso hands every line its surface as origin, the kernel keeps one answer per origin, and a numbering goes only to the surface whose line listed. A surface that leaves takes its answer with it; one that attaches has listed nothing yet (#1273).
