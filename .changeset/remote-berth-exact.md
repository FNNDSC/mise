---
'@fnndsc/chell': patch
---

A terminal attaches to a stratus daemon by its identity (`chell --remote rudolph@fnndsc`), two-@ users included.

The target is tried as typed before it is read as a CUBE URL, so a berth keyed by a cloud identity (`user@tenancy`) matches, and a user that is an e-mail address splits on the last `@`. `chris@cube.example.org` still finds the normalised `chris@http://cube.example.org` berth.
