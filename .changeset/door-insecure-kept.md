---
"@fnndsc/chell": patch
---

A door logged into with `--insecure-door` now works afterwards. The choice is kept with that door, so `chell -c '…'` uses it over plain http (saying so on each use) instead of refusing every command. Log in again with `--insecure-door` once to record it.
