---
"@fnndsc/chell": patch
---

The --host-control help now lists the tasks tier and says that a bare flag grants shell, files and pipes only.

The attach banner now says what each tier hands the daemon, in the order the daemon gave them, so a daemon granted only `tasks` reads "jobs may change the cloud and bill" rather than claiming `!` and pipes run on its host.
