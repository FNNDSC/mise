---
"@fnndsc/menu": minor
"@fnndsc/stratus": minor
"@fnndsc/argus": minor
---

A new domain finds its DNS zone in the tenancy: the only one by default, else one chosen on SIZE or named.

`domain new` and `domain size` read the tenancy's DNS zones; a named `--base-domain` must be one of them, and with several and none named `domain new` refuses, listing them. The size model carries `dnsZones`. In ARGUS, SIZE shows a ZONE choice and COMMIT stays dark until a zone is set.
