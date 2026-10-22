---
"@fnndsc/stratus": minor
---

A domain gets its own compartment and is born protected. The build's first step, `compartment`, makes `domains/<name>` (and `domains` once) tagged `mise-domain=<name>`, so a second tenant needs nothing made by hand; the shared zone and the `openshift-tags` namespace are found wherever the tenancy keeps them. `domain teardown` refuses a protected domain until `domain protect <name> off`, a line of its own. `domain build` asks for Red Hat's service account when it will need one and none is kept, and keeps it on the host, mode 600 (stratus.adoc D14).
