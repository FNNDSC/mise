---
"@fnndsc/brasa": patch
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
"argus": patch
---

docs(calypso): say calypso where the component is meant, and make it typeable

Every other part of the stack is a noun with a role — cumin, salsa, chili, brasa, menu, chell, argus. The session supervisor was the odd one out, described by a flag on another program, so the prose said "the daemon" for something that already has a name, a package, a binary and a doctrine document.

Host control is *calypso's* policy; berths are calypso's; the wire is calypso's. "Grant calypso host access" says whose policy changed. "Grant the daemon" does not.

Operator-facing text now names it: the flag help, the not-running message, the already-running refusal, the listening banner, the attach errors, the several-sessions chooser, and the host-control sentences — `upload` refusing without the `files` tier, the HOST banner, and argus's HOST lamp tooltip.

The start hints used to read `chell --daemon <user>@<url>` while the prose said "run calypso". They now say `calypso <user>@<url>`, which is a real command, since calypso ships its own binary. The getting-started guide leads with what calypso *is*, then gives both ways to start it — standalone from a saved session, or through chell logging in fresh — because they genuinely differ and one does not replace the other.

**Daemon survives where it is correct**: a mode name, an anchor, a make target, a background process. Code symbols are untouched — `daemon_launch` and its kin describe something that really is a daemon, and churning them buys nothing an operator sees. Command lines inside code blocks were left alone, so nothing became a command that does not exist.
