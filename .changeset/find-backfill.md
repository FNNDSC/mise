---
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
---

Finding jobs by pipeline run is complete about seven times sooner on a large account (#1253): `find … -pipeline` waits less. Which pipeline run made each job is read again, behind the prompt, for jobs an older checkpoint lacked, and that read took hours.

The jobs it lacks sit in a few big feeds (on one account three feeds held all 118k), and they are each feed's older jobs: CUBE lists a feed newest first, and an earlier pass had already learned the newest. The read now starts each feed where the unknown jobs begin instead of at its head, reads pages in parallel across all its lanes instead of one feed page after page, and reads a feed whole when the skip missed any. Measured on that account: about 5,000 jobs learned a minute, from about 700.

`proc stat` says how far it has come while it reads: `pipeline runs : reading behind the prompt, 155/1061 pages`.
