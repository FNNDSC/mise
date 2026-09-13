---
"@fnndsc/argus": patch
---

Every colour pairing that carries type now clears WCAG 2.1 AA, in all five schemes. Three defects: the clinical navy carried black 22px type at 2.35:1 where the bar is 3:1, and it is the default scheme; the inert gutter blocks faded ground and label together and reached 1.36:1, so they now invert instead of fading; and the about-face telemetry caps, small enough to be held to 4.5:1, invert under the clinical schemes only. Measured per theme in `docs/WCAG-AA.adoc`.
