---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
"@fnndsc/chell": patch
---

ARGUS and the calypso daemon say when they are different builds. ARGUS's build writes its stamp into the bundle; the calypso daemon reads it once at start and reports it in its attach ack (`stack.surface`, optional in the wire schema). When ARGUS's own stamp differs, it says which is older and what to restart — on the status strip, in a dismissible notice, and on the console: "ARGUS is newer than the calypso daemon, so some controls won't work. Restart the calypso daemon." or "ARGUS is older than the calypso daemon. Refresh to load the new ARGUS." A remote chell prints one line at attach when its build differs from the daemon's.
