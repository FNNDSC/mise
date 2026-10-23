---
"@fnndsc/stratus": patch
---

The `compartment` step waits out a just-made `domains` compartment that OCI does not yet find, instead of failing.

Found live building quay: the parent read ACTIVE while creating a compartment inside it answered not found. The step now retries a not-found for up to ten minutes, logging that it waits.
