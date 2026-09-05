---
"argus": patch
---

refactor(argus): a listing column is declared once

Both tabular panes said what their columns were twice: once to `RosterOrder`, which draws the caps and sorts by them, and again in the code that emitted each cell. The two could not drift visibly, because the grid would break, but they could drift in meaning — a cap saying one thing while the cell beneath it showed another.

A trait now carries the cap's label, the cell's class, what the cell holds and how rows compare under it. `RosterOrder` takes its caps and its comparator from the same declaration that emits the cells, so the two cannot disagree.

Comparison defaults to the cell's own text, so a column declares an ordering only where display and order genuinely differ: a size shown as `1.2 MB` sorting by bytes, a date shown short sorting by its full stamp.

Row state stays out of the model. `files-denied`, `feedlist-arrived` and the status classes mark a row, not a column, and forcing them through a column model would say something false about them. A pane supplies them through its own hooks, and the module records why so the next reader does not unify them on resemblance.

Nothing an operator sees changes. The argus smoke suite passes unedited at 63 checks, including the scenario that sorts and filters by these very columns.
