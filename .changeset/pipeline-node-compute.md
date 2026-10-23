---
"@fnndsc/salsa": patch
---

A pipeline run with no `--compute` runs each node on a compute its plugin is registered on, not always `host`. It keeps `host` where the plugin has it, else takes the plugin's first. On a CUBE whose computes are named otherwise (ekanite's `argentum`), every `pipeline run` and `gather process` of a pipeline was refused until `--compute` was given (#1226).
