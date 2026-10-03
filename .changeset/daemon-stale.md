---
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
"@fnndsc/argus": minor
---

The calypso daemon knows when it is stale. It fingerprints its own packages' code (version and compiled scripts' content) when it starts, reads the fingerprint again on every attach and once a minute, says `stale` in its attach ack, and pushes a `stale` message when the answer flips. ARGUS says CALYPSO DAEMON OUT OF DATE only when the daemon says so, so an ARGUS-only release no longer alarms every running daemon; an open ARGUS learns of an upgrade within a minute. A daemon too old to report `stale` falls back to the build-stamp comparison.
