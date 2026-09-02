---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
---

Checkpoint integrity: a snapshot whose topology-loaded feeds are missing from its roster is refused (never overwrite a good checkpoint with an amputated one), and an empty public-feeds walk while public feeds are already known is treated as a failed source — the known feeds are kept and a warning raised — instead of authoritative absence that removed every public feed from the roster.
