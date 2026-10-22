---
"@fnndsc/stratus": minor
---

A domain harbor-oci built can now be adopted and planned against from the session. `domain adopt <name> --from <checkout>` keeps its ids, spec, step evidence and secrets (mode 600, never served) with the domain's own state; with the `tasks` tier it also makes an OCI Resource Manager stack of Oracle's pinned `create-cluster-v1.6.1.zip`, tagged with the domain's name, and imports the Terraform state the checkout kept. `domain plan` with the tier then runs a plan job against that stack and reads the plan back as JSON, counting `Oracle-Tags` drift apart from real change. An adopted domain is never built on, and a domain kept here stands in for its checkout in the tree. Every Resource Manager job's log follows into the step's, and a stop cancels the job without forcing it.

A plan's line counts a resource destroyed and made again as replaced, naming the kinds, so a re-plan of the live domain reads "0 to create, 21 to replace (loadbalancers), 0 to change and 24 Oracle-Tags drift, 0 to destroy". Adopting again finds the stack already tagged with the domain's name and takes it, rather than making a second. A Resource Manager log that cannot be read while the job writes it no longer fails the step: it is read again on the next poll.
