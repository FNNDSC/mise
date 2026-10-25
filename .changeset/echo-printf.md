---
"@fnndsc/brasa": minor
---

A session can now write words and formatted text: `echo` and `printf`. `echo` writes its words on a line, with no options and no escapes (`-n`, `-e` or `-E` as the first word is refused by name), so `echo feed ${R.feedId}` shows a variable's field. `printf` is POSIX's subset: `%s`, `%d`, `%i`, `%%` with flags, width and precision, the escapes `\n`, `\t` and `\\`, the format reused while arguments remain; anything else is refused by name, and the text always ends its line. Both answer with text, so `A=$(printf …)` holds what was written.
