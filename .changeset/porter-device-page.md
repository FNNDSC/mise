---
"@fnndsc/porter": patch
---

The door has a page to type a chell code at. `/device` puts a code field beside the username and password, as github.com/login/device does, and authorising a code also starts the user's session when none is up, so a first-ever `chell auth login` is followed by a `chell -c` that works.
