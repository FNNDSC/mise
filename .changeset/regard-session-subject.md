---
'@fnndsc/brasa': minor
'@fnndsc/calypso': minor
---

Regard: the session learns what the operator is indicating.

The wire contract gains one message, `regard`, travelling both directions
under one shape: a surface reports the addressable thing the operator most
recently indicated (a file clicked in a browser, a DAG node selected), and
the daemon retains it as session truth — last write wins — mirrors it into
the engine, and rebroadcasts it to every attached surface. A late attacher
receives the retained value with its ack, so spawn-then-see workflows start
seeing immediately.

The value is an address in the namespace plus the model kind it was
indicated through, never view-space coordinates: what has no address is view
state and stays surface-side. The brasa session retains the value behind
`regard_get`/`regard_set`, so engine-side consumers can answer "what is the
operator regarding" without any surface geometry crossing the seam. Design
record: apps/argus/docs/aegis.adoc.
