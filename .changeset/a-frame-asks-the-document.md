---
"@fnndsc/argus": patch
---

ARGUS: a listing opens the frame of the pane it is in, not the one it was built in.

Indicating a row inside a node dive lit the row and put its verbs in the zone, but the mode frame never opened, so the verbs stood behind a closed frame. The listing resolved its pane once, at construction, and the node overlay builds its browser before appending it to the scene — so that listing's pane was null and stayed null, and the attribute that opens the frame was never written.

The façade now asks the document for the pane each time it needs one, and installs its frame watcher on the first paint that finds one rather than at construction. A unit test builds a listing detached, attaches it, and requires the frame to open.

The same stale answer had also left the MKDIR smoke scenario typing into the console after that question moved to the pane; it now answers on the bar.
