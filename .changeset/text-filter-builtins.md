---
"@fnndsc/brasa": minor
"@fnndsc/calypso": patch
---

A pipe ends in wc, head, tail, sort, uniq or cut on every surface, ARGUS's terminal included: they run in the session.

`find /proc/jobs -plugin pl-dylld | wc -l` failed in ARGUS: `wc` was a host program, and a browser runs none. The six are builtins now, with POSIX's common flags and meanings (`wc -lwcm`, `head`/`tail -n N`, `-N`, `head -n -N`, `tail -n +N`, `sort -rnfu -k N[,M] -t C`, `uniq -cdui`, `cut -f/-c LIST -d C -s`), reading what is piped in or ChRIS files named as operands. A flag they do not take goes to the system program, with the piped text, where the surface runs one, and is refused by name where it does not; `command sort` still asks for the system's. The daemon now says truly whether the acting surface can run a pipe segment (a chell can, a browser cannot, any surface under `--host-control pipes`), so grep and these filters answer in the kernel rather than handing text to a browser that refuses it.
