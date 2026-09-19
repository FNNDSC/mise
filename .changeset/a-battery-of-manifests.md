---
"@fnndsc/brasa": minor
---

brasa: the pronouns a chain needs, and claims that look where a plugin files its output.

Built while writing the first battery of manifests, and each one is a thing a real workflow could not say before:

`${run.place}` — where the last run writes. A chain works on what the previous act produced, and only the kernel knows where CUBE put it; a manifest cannot spell a path that holds an instance id it never saw. With it, `cd ${run.place}` chains one plugin onto another's output.

`expect path <p> count --deep` and a tag claim that looks beneath the path it was given. A plugin files its output in a tree — pfdicom writes under `share/incoming/<input tree>` — so a claim made at the node's own folder was false about a run that had worked perfectly. `--deep` is declared a boolean flag, because undeclared it took the comparison as its value and the claim lost its predicate.

A dry run leaves a pronoun it cannot know as it was written, rather than refusing: nothing has run to give `${run}` a value, and refusing there made `--dry-run` useless for exactly the manifests that chain. `play` also reads a manifest from the engine's own disk when the ChRIS filesystem has no such file, which is how a repository's battery runs without uploading itself first — and it drains the CFS miss it went looking for, which was otherwise left behind and made a clean play exit non-zero.

A claim now prints as it was MADE, narrowing included: a ✓ reading `count gt 0` for a claim about `*.nii*` says the wrong thing held, and a battery is read by people who were not there.
