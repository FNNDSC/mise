---
"@fnndsc/argus": patch
---

The pipeline cycler's seed `ls /bin` at boot is no longer observed by the panes, and the surface lists the session's working directory once on attach, so a browser following the session opens where the session is rather than in `/bin`.
