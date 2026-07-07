---
"@fnndsc/chell": minor
---

Introduce the output sink seam (`OutputSink`, `StdoutSink`, `BufferSink`, `envelope_deliver`, `envelopeHandler_wrap`): command output now leaves the engine through a host-installed sink instead of builtins assuming a terminal. The REPL installs a stdout sink, preserving CLI behavior exactly. First builtins converted to envelope returns (`pwd`, `whoami`, `whereami`), registered in the dispatch table through the compatibility wrapper and exposed raw via the new `ENVELOPE_HANDLERS` registry for envelope-aware hosts. See docs/calypso.adoc.
