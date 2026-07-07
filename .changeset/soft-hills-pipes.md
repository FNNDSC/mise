---
"@fnndsc/chell": minor
---

Pipes and redirects consume envelopes. The capture seam now feeds pipe chains and redirect targets from envelope-speaking commands' rendered text with ANSI stripped (plain pipes, the documented deviation from historical escape-byte leakage), passes error-stream text live to stderr, and still captures direct stdout writers such as binary cat. Legacy printing commands keep the old capture path unchanged.
