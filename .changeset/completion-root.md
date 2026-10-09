---
"@fnndsc/brasa": patch
---

Completion at the root no longer offers `/pacs`, which does not exist (#1023). PACS lives at `/net/pacs`; the root offers `/bin` and `/usr` beside what `/` lists.
