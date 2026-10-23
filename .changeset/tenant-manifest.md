---
"@fnndsc/stratus": minor
"@fnndsc/argus": minor
---

A tenant is a manifest: `~/tenant.mise` builds a domain from its written spec through the install and verifies it.

stratus ships `tenant.mise` and shows it in the session's home beside the domains; `play ~/tenant.mise --param NAME=quay` runs `domain build --through run`, `domain verify` and their claims, answering the domain's status. The session's files can now be read by `play` and a surface. In ARGUS, the TD controller's COMMIT writes the spec and then plays the tenant on BUILD.
