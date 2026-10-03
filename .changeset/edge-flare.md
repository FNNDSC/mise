---
"@fnndsc/argus": minor
---

A scrolling field answers its edges, as a phone's list does. Meeting the top or the foot — a scroll come to rest there (the wheel, a finger, an N MORE press that reaches the end), or a wheel or finger pushing past an edge the field already stands on — flares that edge in the theme's hue and gives the field's contents a small bounce. Every field that wears the MORE chip gets it, through `more_wire`; the script only says which edge was met (`data-edge`), the stylesheet draws the flare and the bounce, a spinning wheel is one meeting, and nothing moves under `prefers-reduced-motion`.
