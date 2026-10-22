---
"@fnndsc/stratus": minor
---

The stratus prompt says where in the substrate a session stands: cloud, tenancy, region, user, domain, directory.

The domain segment appears when the working directory is inside one.

Sent as the wire's backend-neutral segments (docs/stratus.adoc, D9). Disconnected, the leader reads `OCI ✗` as an alert. The user is the identity as the cloud writes it, never shortened by the daemon; a surface short of room truncates it from the left.
