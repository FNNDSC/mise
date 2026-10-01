---
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
---

A feed the roster gains after the topology sweep lands its jobs on its own: every roster sync (the watcher's delta, the full walk, a restored roster brought into service) queues the feeds it leaves without topology, and one detached walk at a time lands them behind the prompt — so a feed created after the sweep, or restored from a roster whose shard was never written, shows SIZE and TIME in the RUNS listing without anyone opening it. `proc stat` names the feeds still landing.
