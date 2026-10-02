---
"@fnndsc/argus": patch
---

Cleanup, slice 2b: the desktop — the stage captured as a script of console lines and replayed, with the births the opens record and the replay place they read — is a module of the host (`app/desktop.ts`, `desktop_wire(context, hooks)`), its capture split into one action per pane and its replay into one step per action, unit-tested in jsdom with a recording stage. The host hands it its open verbs as hooks and keeps its call sites. One dead constant (console sub-verbs no one read) removed. No behaviour changes.
