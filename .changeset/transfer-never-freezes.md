---
"@fnndsc/calypso": patch
"@fnndsc/argus": patch
---

A download's row never freezes, and a cancelled download stays cancelled. Every question the row asks the session has a 5 s deadline: a session that stops answering reads LOST TOUCH WITH THE SESSION, and a cancel with no answer says so and can be pressed again. A cancel made while CUBE was still answering no longer lets the download start anyway.
