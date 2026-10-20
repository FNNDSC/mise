---
"@fnndsc/stratus": minor
---

stratus: a session over the cloud substrate a Trusted Domain runs on, reading a tenancy.

The first slice of docs/stratus.adoc: one backend, clouds as drivers. The package holds the driver interface, a fake cloud that runs the driver contract, and the OCI driver over Oracle's SDK (identity, compartments, regions, availability domains, limits, shapes, list prices). A session mounts its tenancy under /net/oci/<tenancy>/: compartments nest as the cloud nests them, a duplicate name wears ~<id6> and the plain name refuses, regions/ holds each region's zones, limits, shapes and prices as folders of field files, domains/ is the home. Every answer is kept for a minute. The stratus command hosts the session as a calypso daemon on the bastion; --fake hosts the fake cloud. CI boots it with no ChRIS package loaded and a ratchet keeps oci-* imports inside the OCI driver.
