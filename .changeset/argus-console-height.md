---
"argus": patch
---

fix(argus): the operator divides the stage, not a constant

The console could not be dragged past roughly half the frame. The drag had no cap of its own; the wall was a `min-height: 20rem` workspace floor on `main`. A floor there is a ceiling here, because the drawer can only grow into space the workspace will give up, and the floor was lifted only for the console's own zoom.

The floor is gone. The drag is now bounded only by what the screen imposes: a minimum so the strip stays grabbable, and a ceiling that keeps the console's own header on screen so the controls that shrink it again remain reachable.
