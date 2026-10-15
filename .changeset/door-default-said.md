---
"@fnndsc/chell": patch
---

chell now says which door it is using when a plain-http door is refused. A login to a second door that leaves an earlier one the default says so, with `--default` to switch. A refused door names itself, says when it is your default, and points at a door you are already logged into with `--insecure-door`.
