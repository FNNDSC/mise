---
"argus": patch
---

test(argus): the smoke suite waits for motion to stop instead of guessing how long it takes

Several scenarios slept a fixed number of milliseconds after a gesture that animates, then measured. That samples a CSS transition at an arbitrary moment: sometimes mid-glide, sometimes before the click had even registered. The header-slide check drifted between one and thirteen pixels of residue and occasionally read the header's full resting position, and the split-zoom, restore-strip and mode-frame checks flickered alongside it.

Scenarios now wait for the value under test to stop changing. The checks are stricter as a result, not looser: the header-slide tolerance goes back to a single pixel, where it had been widened to two to accommodate the noise.

No production behaviour changes here. The one thing worth stating plainly is what this was not: the slide distance was correct throughout, and two attempts to "fix" it in the page were reverted once the suite could measure it honestly.
