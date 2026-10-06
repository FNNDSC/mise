---
"@fnndsc/porter": minor
---

The door takes a token as well as a password, so a script can come through without one. A human login can mint a named door token (a JSON login asking for one, or the browser authorising a chell by one-time code on the login page); the door keeps only its hash, with the name and the day it dies (`PORTER_TOKEN_DAYS`, 30 by default), and a script presents it as `Authorization: Bearer`. A session not up boots on the login it saved. Expired and unknown tokens are refused by name, and the journal says who came through by which token.
