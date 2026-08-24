---
"@fnndsc/cumin": minor
"@fnndsc/salsa": patch
---

Typed chrisapi wire contract over the jobs and PACS surfaces. cumin gains
`feedsPage_get`, `publicFeedsPage_get`, `pluginInstancesPage_get`,
`pluginInstance_get` (typed detail handle with parameters, status, logs,
delete), and `downloadToken_create`, with the wire row shapes (`FeedData`,
`PluginInstanceData`, `InstanceParameterData`, `DownloadToken`) declared once.
salsa's proc provider, job operations, and retrieve watcher now call the
contract instead of casting the opaque client per call site.
