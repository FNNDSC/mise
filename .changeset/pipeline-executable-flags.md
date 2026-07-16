---
"@fnndsc/brasa": patch
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
---

Route a pipeline executable's bare `--signalflow` flag to SignalFlow diagram output and provide contextual help for dynamic pipeline commands. Propagate remote pipe-segment failures back to the engine instead of crashing the ChELL client, and consistently document `signalflow -` for stdin rendering.
