---
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
---

Host control: `chell --daemon --host-control[=shell,files,pipes]` lets the daemon declare capabilities of its own — `!` runs on the daemon host, pipe segments run there, `upload`/`download` reach its disk — off by default, refused on a non-loopback bind without `--expose-host-control`, and annunciated everywhere (attach ack `hostControl`, the daemon face, the prompt's HOST segment, a remote shell's banner). Without the `files` tier, `upload` under a daemon now refuses instead of reading the daemon host's disk.
