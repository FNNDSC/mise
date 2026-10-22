---
'@fnndsc/stratus': minor
---

A tenancy's instances, networks, load balancers, volumes, buckets and DNS zones list under each compartment.

Every container level holds a kind folder per resource kind for the session's region, counted by one Resource Search. A resource is a folder of field files (`name id state region created tags info.json`, plus an instance's `shape zone ips`, a volume's `size attached`, a load balancer's `ip shape`); a network nests `subnets/` and `securitygroups/`; a bucket shows `links` and its `objects/` as files (small ones readable); a DNS zone shows `records/`, a file per name. `ls -l` marks each kind and shows its lifecycle state, coloured. Duplicate names wear `~<id6>`, answers are cached a minute.
