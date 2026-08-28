---
'@fnndsc/chell': patch
---

The brain lights up on a clear screen when credentials are accepted.

The pulse repaints by moving the cursor up to where the logo is, so the logo
must still be on screen. By the time login finishes it usually is not — the
logo and the login output have scrolled past the top — and an animation that
cannot reach its anchor paints at row zero instead, over the boot report and
the daemon's own addresses. The flickering brain and the mangled banner were
the same defect.

`logo_reviveOnScreen` homes the cursor, clears below it, and redraws the logo
alive at row zero. The anchor is restored and boot output has a whole screen to
flow into beneath it, so the animation runs through warm-up and the banner
without reaching anything else.

It also restores the sequence the animation existed for: the brain is dead
while credentials are checked, and comes to life once they are good.
