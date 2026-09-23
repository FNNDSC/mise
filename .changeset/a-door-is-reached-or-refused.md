---
"@fnndsc/chell": patch
---

chell: `--door` takes a door typed without a scheme (`localhost:4180` is `http://localhost:4180`), asks for the username when the login config holds an empty one (it used to ask "Password for  at …"), and says in one line when a door cannot be reached or is not an HTTP(S) address instead of dying with a stack trace.
