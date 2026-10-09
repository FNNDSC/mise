---
"@fnndsc/brasa": patch
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
---

Nothing changes at the prompt: a daemon's berth name comes from its backend's account of who the session is (#982). The descriptor gains `session.identity_get()`, which returns a `SessionIdentity` (`user`, `where`, `connected`). For ChRIS that is the CUBE user at the CUBE URL, or `disconnected@no-cube` with no login, so every berth name, key and attach hint is the same as before. Each backend names its own disconnected session, so two backends never share one. calypso's launch reads the identity there and no longer imports cumin. chell keeps its folder, query and job checkpoints under the same name, through the backend. `identity_forSession` and `DISCONNECTED_IDENTITY` stay exported from calypso.
