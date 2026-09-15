---
"@fnndsc/argus": minor
---

A new SLAB layout: a crisp acquisition slice sweeping through a ghost of the volume. The slice is the real DICOM image at its true depth, windowed by the pane's W/L; the rest is a faint volume render (`image ghost <0..1>|off`). The wheel sweeps the slice, left-drag rotates, the bar reads `SLAB · z n / m`. It is the one layout that drives its own vtk render window rather than a Cornerstone viewport, because a vtkImageSlice composited into a Cornerstone VOLUME_3D viewport crashes that viewport's z-buffer pass in the pane while the same actors compose fine in a plain vtk renderer. DICOM series only for now; a niivue path for NIfTI/MGZ comes later.
