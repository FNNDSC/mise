---
"@fnndsc/brasa": minor
---

The typed chell API, first tranche. `chellApi_create()` returns the shell's
vocabulary as function calls: `pwd`, `cd`, `mkdir`, `touch` and `rm` take
typed options, enter the same per-command cores the parsed builtins enter,
and return envelopes whose model slot is typed per command
(`TypedEnvelope<K>` over the new `FsModelMap`). No command line is
assembled or parsed anywhere on the path.
