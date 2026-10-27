---
'@fnndsc/argus': patch
---

The stratus dashboard paints DOMAINS without waiting on `capacity`. A paint waits a moment, shows CAPACITY as READING, and paints again when the answer lands; one `capacity` is on its way at a time.
