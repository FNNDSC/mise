---
"@fnndsc/cumin": minor
---

Add the command result envelope (`CommandEnvelope`, `EnvelopeModel`, `ResolutionTrace`, `envelope_ok`, `envelope_error`, `envelope_isOk`): the typed container in which a command's outcome travels from execution to its host, carrying rendered terminal text alongside an optional kind-tagged model, drained error detail, and an optional intent-resolution trace. See docs/calypso.adoc for the governing design.
