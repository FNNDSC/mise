---
"@fnndsc/brasa": patch
---

`image` is a kernel command, but it was missing from the two places that enumerate commands for the operator: tab-completion (offered from the help registry) and the grouped `help` listing (grouped by a hardcoded category map that had no imaging category). It had a help entry, so `image --help` worked, but the entry carried no summary and belonged to no category, so it never appeared in `help`. Now `dcm` and `image` share an `Imaging` category in the listing, the `image` entry carries a one-line summary, and `image`/`dcm` take path-argument completion like the other path commands — so `ima⇥` completes to `image` and `image ~/up⇥` completes a path.
