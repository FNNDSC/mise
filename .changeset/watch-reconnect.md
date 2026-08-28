---
'@fnndsc/salsa': minor
'@fnndsc/brasa': patch
---

A dropped retrieve watch reconnects instead of giving up.

The LONK socket is only how a client watches a retrieve; the retrieve itself
runs on the server and is unaffected by the socket dying. Losing the view was
nonetheless the end of the watch — which is why a 22-series study failed where
a 2-series one did not: a longer retrieve gives the socket more chances to
drop.

A dropped socket is now reopened, up to three times, and re-subscribed to the
series still in flight. Nothing is re-fired: those retrieves were never lost.
The reconnection is announced, because a silent one during a long pull is
indistinguishable from a stall.

Only when reconnection is exhausted does the watch stop, and it still records
the remaining series as `unconfirmed` rather than failed.
