---
"argus": patch
---

refactor(argus): one frame-and-field host for the tabular panes

The files listing and the runs roster arrived at the same arrangement separately — mount a `RosterOrder` frame, append a scrolling field beneath it, fill the field with rows — so the arrangement was copy rather than shared code. A fix to one had to be written again for the other, and the stylesheet carried two field rules differing only by a `padding-right`.

Both now use one host. The duplicated `field_open` is gone from each panel and the two rules collapse to a shared `.listing-field` plus a one-line files override.

The host is deliberately narrower than planned. It was to own the state line and the empty state as well, but reading the panels closely those only resemble each other: the files bar toggles a single class and joins parts, while the runs bar swaps among three liveness classes and stays silent while a graph is on stage. Pulling them together would have changed behaviour, so they stay put, and the reasoning is recorded in the module rather than left to be re-litigated from resemblance.

Nothing an operator sees changes. The argus smoke suite passes unedited at 63 checks, which is the evidence.
