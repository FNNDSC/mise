---
"@fnndsc/argus": minor
---

feat: the listing is declared into, not wired up (#428, S1)

Three panes assembled the same listing by hand — order, host, chrome lookups, filter block, strip observer, the `argus:roster` parse — and after the browser and the roster gained their verbs each had also added an action track, an indication model, a readout and (in one) a selection by hand, in two spellings. It cost something: the grid gained a track and the `..` row kept its old cell count, and a row one cell short shifts every cell after it into the wrong column.

`Listing<T>` in `features/roster/listing.ts` is that composition owned once. A pane declares its traits (each carrying its own grid track), its key, its chrome by root and prefix, and what a row may do; the façade computes the grid template, writes `--roster-cols`, blanks the caps over leading ornaments, reserves the action track on every row and fills it on indication. Declared actions mint the track and split click from double-click; no actions means no track and one click. `rows_set` names the field, so a selection survives a filter and a re-listing and clears on navigation. Blocks carry an optional lead row outside the order, a painter may draw a block as cards, a state composer lets a pane prepend its own words, and a child level mints its caps per open group and reads one filter down the levels.

Additive: `ListingTrait` gains optional `width` and `capped`; `RosterOrder` and `ListingHost` keep their signatures; no pane is converted in this slice. The app gains its first DOM unit tests (jsdom), which prove that every row holds exactly as many cells as the grid has tracks.
