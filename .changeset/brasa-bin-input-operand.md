---
"@fnndsc/brasa": minor
---

A plugin or pipeline run from `/bin` takes its input as an operand: a directory, or files shaped into subjects.

A `/bin` run used to take the working directory only. Now `pl-freesurfer-v1.0.4 ~/uploads/subjects` runs on that tree: inside a feed, that node is the input and the run continues the feed; outside one, pl-dircopy roots a new feed of it first, as it did for cwd. A file operand is one subject: chell copies it to `~/.mise/stage/<id>/<subject>/<file>`, named by the file's stem (`t1.nii.gz` is `t1`) or by `as <name>`, roots a new feed of the stage, and prints the subject and the path CUBE made of it. Several files are several subjects; `t1.nii t2.nii as sub-01` is one subject holding both. Operands come first on the line and the plugin's flags after; a flag before an operand is written with `=`. A path is read as given, a directory when one stands there, a file otherwise, and a missing path refuses. To an fs plugin an operand is its `dir`, untranslated. Pipelines take the same operand, and one outside a feed now roots a new feed rather than refusing (#1303).
