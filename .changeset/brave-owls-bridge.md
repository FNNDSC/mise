---
"@fnndsc/chell": minor
---

Capture bridge for legacy printing builtins: `CaptureSink` (data and err buffered, status passed live so spinners stay visible) and `printingHandler_wrap`, which runs a printing handler under capture and returns its output as an envelope with status derived from the exit code. The resource-group commands (feed, plugin, compute, tag, group, pluginmeta, plugininstance, workflow, files, links, dirs, context, parametersofplugin, and aliases) now flow through the bridge: envelope semantics, identical bytes, typed models deferred until a structural consumer exists.
