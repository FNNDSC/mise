---
"@fnndsc/brasa": minor
"@fnndsc/chell": patch
"@fnndsc/argus": patch
---

A backslash inside single quotes is now just a backslash, as in any POSIX shell (#1258). `grep '\.mgz$'`, `find … -name '*\.nii'` and `printf '%s\n' a` reach their command with the backslash they were written with; before, the line dropped it, so a pattern meant "any character" where it said a dot.

Quoting follows POSIX throughout: inside single quotes every character is literal; inside double quotes a backslash escapes only `$`, `` ` ``, `"`, `\` and newline (`"a\"b"` and `"\$HOME"` work as before) and stays before anything else (`"a\b"` keeps it); outside quotes it escapes the next character. The word parser and the `;`, `|`, `>` and `$( … )` splitters read one rule (`lib/quoting.ts`), so none of them splits a line its words read otherwise. A line that relied on `\'` inside single quotes, such as `'it\'s'`, now closes the quote there; write `"it's"` or `'it'\''s'`.

ARGUS quotes the lines it writes (an EDIT save, a cohort's `gather add`, a tag) the same way: single quotes, with a single quote written `'\''`. Its old quoting doubled every backslash and wrote `\'`, which under these rules doubled a backslash on every save and refused text with an apostrophe.
