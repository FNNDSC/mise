---
"@fnndsc/cumin": patch
"@fnndsc/brasa": patch
---

A run started from inside a node's output now attaches to that node, not to a folder that merely looks like one (#1268). In `…/pl-dircopy_734517/data/subject_01`, a plugin or pipeline run used to start from instance 1, because the path reader took the deepest folder named `<anything>_<number>`. The node is now the last `<name>_<id>` of the chain right after `feed_N`, and nothing at or below a `data` folder counts. Plugins, pipelines and `proc here` all read it this way.

A play whose starting folder cannot be given back at its end (removed during the play) now says so in one line instead of throwing over the play's own result.
