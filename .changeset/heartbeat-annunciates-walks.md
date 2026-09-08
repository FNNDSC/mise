---
"@fnndsc/calypso": patch
---

fix(calypso): a feed's topology walk is annunciated on a quiet daemon

The heartbeat re-pushed the promptline only when the index counts moved or the previous push still showed warm-up. A feed's topology walk (a first visit, `proc refresh`) reports its progress into the prompt context page by page but adds its instances to the index only once the walk is done, so on a quiet daemon the counts stood still for the whole walk and the JOBS readout never named the feed — it was annunciated only when a background sweep happened to be moving the counts at the same time. The heartbeat now also pushes while a foreground command is executing, which is exactly when a walk can be in flight.
