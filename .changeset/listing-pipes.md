---
"@fnndsc/brasa": minor
---

A numbered listing now travels through a pipe, so `query … | gather add` gathers what the query found. Between builtins the listing goes along with the text; a pipe's last listing becomes the one `@SER3` names; and `${listing}` stands for that listing's series, files or folders. `gather add` or `gather remove` with nothing to act on now says what it takes instead of failing quietly.
