---
"@fnndsc/brasa": patch
---

A bare `sudo` says its usage (#1022). sudo's own refusals (no command, a nested sudo, no administrator to become, empty credentials) were returned but never written, so `sudo` alone printed nothing and exited 1. The nested command still writes its own output, once.
