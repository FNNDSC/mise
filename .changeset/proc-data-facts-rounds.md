---
"@fnndsc/salsa": patch
---

The data-facts sweep reads in rounds: what a round cannot answer yet (a header that failed once, a read that ran out of time) is tried again after a pause, until a round records nothing and every header has had its tries. A single round had left 199 of 709 feeds unread for as long as the daemon lived.
