---
'@fnndsc/chell': minor
'@fnndsc/calypso': patch
---

`chell --remote` can attach to a daemon on another machine.

`CALYPSO_BIND` has always opened the wire to the network, and the attach token
has always gated the session — but *discovery* is local. A berth is a file in
one host's runtime directory, so a surface on another machine has none to read,
and the berth recorded `ws://127.0.0.1:<port>` regardless of what the daemon
bound. The wire was reachable and nothing could tell a remote `chell` where to
point: a browser could attach and a terminal could not.

`--attach` takes an explicit address and skips discovery:

```
chell --remote --attach http://pangea:41234/?token=abc123
```

The address is the one the daemon prints. The web surface and the wire share a
port, so the ARGUS link names both and pasting it is the whole interaction;
`--token` supplies the token separately where an address carries none, and
`https`/`wss` are preserved. The berth is built in memory and never written,
since another machine's daemon does not belong in this machine's berth
directory.

A daemon bound to anything but loopback now records a routable URL in its own
berth and prints the ready-to-paste attach command beside the ARGUS link.

This is not the `porter` server. There is no listener beyond the one
`CALYPSO_BIND` already opened, no cross-host auth beyond the attach token, and
no way to discover a daemon you were not told about.
