---
"@fnndsc/chell": minor
---

Answers can be typed ahead, as in a terminal. A line typed while a command runs waits, and the command's next question takes it as the answer. If the command asks nothing, the line runs as the next command. Before, such a line went to the session as a command of its own, beside the one about to ask for it, so `terminate` then `n` without waiting lost the `n`. Ctrl-C forgets what was typed ahead, and a secret is never answered from it. Another surface's output now lands above the line being typed, and the prompt or open question is drawn again beneath it with what was typed so far (#1128).
