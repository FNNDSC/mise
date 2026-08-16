---
'@fnndsc/cumin': patch
'@fnndsc/calypso': patch
'@fnndsc/chili': patch
'@fnndsc/brasa': patch
'@fnndsc/chell': patch
---

Add explicit, command-scoped CUBE elevation with `sudo <command>`. The active surface collects an administrator identity and hidden password; a temporary CUBE client runs only the nested command, then the normal session is restored. Group membership and plugin registration now suggest a copyable `sudo` rerun after an authorization failure, and plugin registration no longer owns a separate interactive admin prompt.
