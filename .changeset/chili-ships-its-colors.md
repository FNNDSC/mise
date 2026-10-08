---
"@fnndsc/chili": patch
"@fnndsc/chell": patch
---

chell installed from npm no longer prints "Could not load color config" before listings. chili's package now carries `config/colors.yml`, and a missing color file is reported once per process instead of on every call.
