---
"@fnndsc/brasa": patch
---

A run now follows itself until it settles, so the header's pulse tells the truth without a pane open on the feed. A new feed entered the cache with its jobs scheduled and nothing revisited them, so RUNNING stayed at zero through the operator's own run and SCHEDULED only ever climbed — one header read `SCHEDULED 90` with nothing running. Starting a run takes out a watch on that feed; the sampler already knew to stop when the feed settles. The watch is taken where a run is started, never inside the cache-writing helper, which would make recording a feed quietly begin visiting CUBE.
