---
"@fnndsc/brasa": minor
---

brasa: the cohort is a kernel subject.

`gather list|add|remove|clear|name` holds the set a session is working on, so building a cohort no longer requires a surface to press on. Membership is keyed by PATH: a PACS series still at the modality, a directory of uploads and a single file are all addressable, so one identity rule covers every kind, gathering the same thing twice merges rather than doubles, and `gather remove` takes the same operand whatever it is removing — or the index the operator just read back.

The cohort lives where the surface already kept it, `~/gather/current.json`, in the shape the surface already wrote, so the two read each other's cohorts with no migration: the kernel fills in what an older record left out (a member written before kinds existed is a series; one written before paths were identity carries its address in `seriesUID`), and preserves the fields it has no name for, because a surface knows things about a series that the kernel does not and a kernel write must not quietly forget them. What a gathered path IS is asked of the filesystem rather than guessed from its spelling, and the holding directory is made and its listing invalidated on every write — a cohort the next `ls` cannot see is the staleness a CSV export already taught once.

This is the first slice of the manifest work (`docs/manifest.adoc`): a workflow can now gather.
