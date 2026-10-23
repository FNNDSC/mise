---
"@fnndsc/argus": patch
---

Typing a domain's name opens the TD controller from the first paint, before the controller has read the domains.

The DOMAINS tile's read now tells the language the domains' names, so a freshly opened stratus session claims `domain quay` at once.
