---
"@fnndsc/brasa": minor
"@fnndsc/chell": minor
---

feat: a missing destination is asked for, not refused with a usage line

`mv foo` names what to move and never says where. Until now that was a usage line — telling an operator the shape of a command they had just typed correctly enough to be understood, instead of asking them the one thing they had not said. A required operand with no value is the same sentence as a value-taking flag with no value, and now gets the same answer: `mv` and `cp` ask.

The ask is the typed `path` ask that already exists, so neither verb knows which surface it is talking to: a terminal renders it as a line, and a surface that browses borrows a files pane for it. It opens where the source already lives, wants a directory when there is more than one source, and its committing control reads `MOVE HERE` or `COPY HERE`.

It offers no default name. The only name `mv` could propose is the source's own, and the first live run took Enter as exactly that and moved a file onto itself. The rule that came out of it holds for every path ask, and the terminal now implements it directly: the **anchor** says where to look, the **suggestion** says what to offer, and a verb with nothing to offer offers nothing — Enter on such a question answers nothing rather than answering with the question.

An abandoned ask moves nothing and says so (`mv: no destination given; nothing moved.`), rather than failing with a description of `mv`.
