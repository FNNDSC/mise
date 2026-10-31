---
"@fnndsc/brasa": minor
---

A bare plugin name at the prompt runs the highest version `/bin` lists for it, and says which.

`/bin` lists a plugin per version, `pl-freesurfer-v1.0.4`, and a bare `pl-freesurfer` matched nothing there, so it fell through to chili and was refused. Now the bare name resolves to the highest registered version on the connected CUBE and prints the resolution as it dispatches, `running pl-freesurfer-v1.0.4 (highest of 1.0.1, 1.0.4)`, so the line read back names exactly what ran. The full name keeps working and pins the version; `help pl-freesurfer` answers with the highest version's help; `/bin` itself is unchanged, since the answer is derived from CUBE's state rather than kept as shell state (#1303). Versions order as dotted numbers, so 1.10.0 stands above 1.9.9 and 1.0.4 above 1.0.4-rc1. Inside a pipe or a redirect a bare name still starts no job.
