---
"@fnndsc/argus": minor
---

feat: the files browser declares its listing (#428, S2)

The files browser is the first pane converted to the `Listing` façade. Everything it used to assemble by hand — the order, the host, the chrome lookups, the filter block, the strip observer, the `argus:roster` parse, the action track, the indication model, the readout and the selection — is now a declaration: traits carrying their own grid tracks, a key, chrome by prefix, the row verbs, the selection, and a state composer that prepends CWD and STALE to the façade's parts. The pane keeps what a browser has beyond a listing: the card and preview projections as a painter, the cwd binding, the stale readout, and the content views.

`--roster-cols` for the files body leaves the stylesheet — it is computed from the traits and written on the mount — so the grid can no longer be miscounted, and the node overlay browser, which declares no verbs, no longer reserves an action-track column it never fills. No behaviour changes: the browser's smoke scenarios pass together, unchanged but for one selector that now reads the façade's `.listing-selected` in place of the pane's old class.
