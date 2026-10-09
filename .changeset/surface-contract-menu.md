---
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
---

Nothing changes for chell, ARGUS or porter users: the engine's output and surface contract now lives in menu. `OutputSink`, `Surface` and their companions are served as `@fnndsc/menu/surface`; brasa re-exports them, and the engine installs its own sink and surface. `BrasaEngine` gains required `sink_install` and `surface_install`, so code that implements it must add both.
