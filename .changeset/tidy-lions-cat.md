---
"@fnndsc/chell": minor
---

Convert cat to envelope returns (model `fs.cat` with per-file outcomes; text content buffered into rendered, binary content streamed with backpressure as before, auto-detection notice emitted live on the err channel so it precedes the bytes). Route the spinner through the sink's status channel: byte-identical on a terminal today, and positioned so transient frames never enter envelopes, pipes, or remote data streams.
