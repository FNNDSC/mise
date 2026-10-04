---
"@fnndsc/salsa": patch
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
"@fnndsc/argus": patch
---

A PACS series that arrives is no longer shown as ERROR. The retrieve watch always asks CUBE before it gives up on a series (with no retries, the default, it never did), a series not seen to finish and not yet in CUBE is UNCONFIRMED with its reason rather than ERROR, and the watch waits a minute (not fifteen seconds) for a PACS slow to begin. Progress messages carry an optional `reason`, shown on the ARGUS badge and in pull's summary. In ARGUS a fresh answer finding a series home in CUBE replaces a pull that ended badly, and a pull waiting on its first file paces again instead of drawing a still empty bar. After twenty seconds of silence a pull checks CUBE and then asks whether to keep waiting (a surface that cannot be asked waits a minute). ARGUS runs the PACS pane's pull and query as the operator's own acts rather than instrument traffic, so they can ask.
