---
"@fnndsc/argus": patch
---

Dismissing the page header expands the body to fill — but zooming a pane while the header was already away slid the pane up twice (the header-away slide and the zoom slide both applied), carrying its top frame and controls off the top of the page. Zoom now owns the presentation: it sets the away state aside for the duration and restores it on unzoom, so a zoom from away runs the same geometry as a zoom from a shown header. The slide distance is read from the header's last rested height, since clearing the away state leaves the header mid-slide and unmeasurable.
