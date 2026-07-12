---
"@fnndsc/chili": minor
---

Add sans-I/O rendering variants alongside the existing printing ones, so hosted surfaces can carry command output in an envelope rather than relying on the caller to capture `console.log`: `pluginParameters_manRender` (view), `PluginContextGroupHandler.parameters_listManRender` / `parameters_fieldsRender`, and `BaseGroupHandler.resourceFields_render`. The original printing forms are unchanged and still used by chili's own CLI.
