---
"@fnndsc/chell": minor
---

Convert cp, mv, and rm builtins to envelope returns (models `fs.cp`, `fs.mv`, `fs.rm` with per-target outcomes; rendered and error-stream bytes identical). Interactive `rm -i` streams live through the sink so confirmation prompts stay in sequence; non-interactive output is buffered into the envelope.
