---
"@fnndsc/brasa": minor
---

A variable can head a pipe and hand on what it holds: `${T1} | grep -i sag | gather add` re-filters a stored answer. Written as an argument a variable still becomes words; at the head of a pipe it hands its model to a builtin that reads one, and its operands as text to anything else (#1226).
