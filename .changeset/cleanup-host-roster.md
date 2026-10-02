---
"@fnndsc/argus": patch
---

Cleanup, slice 2a: the host's eight panel maps are one roster (`PanelRoster` in `app/panes.ts`: filed by pane id, read by kind), the host has a context its modules read (`app/hostContext.ts`: layout, panels, pane instances, subjects, dormant, sound, and the terminal and client read when called), and the first module is wired through it: the pane verbs (`app/paneVerbs.ts`: a bar note, move, flip, resize, the chord keys for a title), unit-tested in jsdom. No behaviour changes.
