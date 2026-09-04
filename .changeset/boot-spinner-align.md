---
"@fnndsc/brasa": patch
"@fnndsc/chell": patch
---

fix(boot): a step's label stops moving when it finishes

A boot step is announced while it runs and again when it settles, and the two lines disagreed about where the label starts. The running line hardcoded a five-space indent against a comment asserting `[ OK ] ` was seven characters wide; the finished line pads its tag to the widest tag and adds a space. The label therefore jumped a column as each step resolved, and the plain non-interactive log was out by three rather than one.

The indent is now derived from the host's own tag width and from whether a spinner glyph precedes the text, since an animated line draws a frame and a space of its own and owes only the remainder while a plain log line owes the whole column. `chell` passes the width it actually renders with, so a longer status added later moves both lines together.

The arithmetic lives in its own import-free module, because the wider engine graph cannot be loaded under jest and an untestable alignment rule is how the first version came to be wrong.
