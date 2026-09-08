---
"@fnndsc/argus": minor
---

feat(argus): PHAROS, the house visual language, as a theme — the lighthouse, flat, on the medical colours; the imported look stays the default

The theme pill gains PHAROS after the four imported schemes. Its shapes are drawn on the existing frame with `clip-path`, radius and one flat band, so no element's box moves: stone (flat colour, lit band, black joint), cut (a 45° facet on each gutter stone's outer corner and small on every cap, capsule and pill), inset (the focused pane's gutter stone tucks in from the outer edge, and swaps when focus moves), lens (the one curve, a Fresnel lens round a breathing lamp at the header stone's foot), flank (the outer silhouette rounded at its two corners behind a course-blue wall), course (bars ending in a point, square junctions, the gallery rail along the header). PHAROS wears the MEDICAL scheme's seven colours in this slice; the state hues derive from them as for every scheme. Chakra Petch and JetBrains Mono are vendored under the OFL. The layout now declares the focused pane on the body as `data-focus`. The root attribute is renamed `data-theme` (a remembered `argus-lcars` choice migrates), and the font names the stylesheet repeated twenty-seven times become two tokens a theme can swap. Defined in `docs/pharos.adoc`, a work in progress.
