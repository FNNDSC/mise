---
"@fnndsc/argus": patch
---

The frame tools work on the layout they belong to. Zoom and pan did nothing in 3D and probe and measure did nothing on MPR, because the tool was never added to that layout's group and the button threw; every layout now declares which tools it offers, the panel dims and disables the rest, and the bindings passivate before they rebind (Cornerstone's setToolActive adds a mouse binding rather than moving it, which is why PAN lit and did nothing). In 3D, rotate, zoom and pan ride the three mouse buttons and the ZOOM/PAN blocks move one to the primary drag. In MPR the crosshair rests on the primary, a pointer tool takes it and clicking the lit block hands it back; the probe reads the volume the plane samples, and length and angle draw on a plane. Also lands the runningReconcile unit test dropped from the previous change by `git add -u`.
