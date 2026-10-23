---
"@fnndsc/salsa": patch
---

A pipeline run with no `--compute` puts each node on a compute its plugin is registered on: `host` where the plugin has it, else the plugin's first. Every node used to be placed on `host`, so on a CUBE whose computes are named otherwise (ekanite's `argentum`) every `pipeline run` and `gather process` of a pipeline was refused until `--compute` was given (#1226).
