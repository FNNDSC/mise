---
'@fnndsc/salsa': minor
---

Three relations CUBE owns that the namespace could not reach are now projected.

**`/proc/workflows`** — instantiated pipelines, beside the jobs they own. A
workflow names the pipeline it ran and owns the plugin instances the run
created, which is runtime state, so it sits with `/proc/jobs` rather than with
the pipeline definitions in `/bin`. It projects as a directory of links: the
`pipeline` entry into `/bin`, each entry under `jobs/` into `/proc/jobs`.
Nothing restates a job's own representation. Links are lazy — a listing names a
link without paying to resolve it.

**`/tags`** — the tags themselves. A tag is a first-class user-owned resource
pointing at many feeds, so projecting it inside a feed would flatten a
many-to-many and make editing ambiguous about which copy changed. One object,
one path.

**`/usr/share/<plugin>`** — a plugin's version-independent identity: authors,
licence, type, repository. `/bin` stays flat; nesting versions under a plugin
directory would make an executable a directory, which is the application-bundle
trick and costs a permanently divided view. The Unix answer was already here —
`/bin` holds executables and `/usr/bin` holds their help text — so metadata
extends that parallel tree. A name given with a `/bin` version suffix resolves
to the version-independent record.
