---
'@fnndsc/argus': minor
'@fnndsc/menu': minor
'@fnndsc/stratus': minor
---

A stratus dashboard shows DOMAINS (each domain's last build step) and CAPACITY (what each zone has free).

DOMAINS reads `domain status` and CAPACITY reads the new `capacity` command, through the wire's new `stratus.domains` and `stratus.capacity` models (menu). `capacity [<family>…]` lists, for the shape families named or those the domains' specs name, each limit their shapes draw on per zone, permitted and free; a shape now names its limit service. A domain with a step gone wrong shows in red.
