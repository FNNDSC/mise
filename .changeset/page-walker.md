---
"@fnndsc/cumin": minor
"@fnndsc/salsa": patch
---

One pagination loop for the wire contract: `listPages_walk` joins `ListPage` in cumin's chrisapi contract, owning offset advancement, total latching, and termination for every paginated CUBE read. The six hand-rolled loops in salsa (five in the /proc VFS provider, one in job search) now consume it, so page-walk edge cases have a single tested home.
