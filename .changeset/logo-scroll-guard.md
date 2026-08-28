---
'@fnndsc/chell': patch
---

The boot animation stops before it can paint over what a daemon prints.

The pulse repaints by moving the cursor up a fixed number of rows, which holds
only while the logo is still on screen. A daemon boot prints far more than a
window holds — the logo, the warm-up panels, then the addresses — and once the
buffer scrolls, moving up clamps at row zero. The logo is then painted over
whatever is visible there, which is the ARGUS link and the attach token it had
printed a moment earlier.

No arithmetic recovers an anchor that has scrolled away, so the animation now
stops while it is still correct: it runs while the logo is on screen and holds
still once output has pushed it past the top.
