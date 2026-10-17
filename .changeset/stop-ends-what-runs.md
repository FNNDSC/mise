---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
"@fnndsc/brasa": minor
"@fnndsc/chell": patch
"@fnndsc/menu": minor
---

Any running command can now be stopped, with Ctrl-C or the console's new STOP capsule. A host process it started is killed, and a command that does not end when asked is abandoned after three seconds so the session is free again. A chell that disconnects stops its command, and Ctrl-C reaches a host program in the terminal.
