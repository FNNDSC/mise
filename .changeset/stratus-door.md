---
"@fnndsc/porter": minor
"@fnndsc/argus": minor
---

One login reaches your cloud too: `stratus oci` switches a ChRIS session to your stratus one, and `chris` comes back. The porter starts or rejoins it on the OCI key filed under the person's ChRIS identity (`porter --creds <user> --oci <config>`, run on the host), in a home and state of its own, read-only unless `stratus oci --spend` is asked for with `spend` typed; it restarts on the same tier and is adopted after a porter restart. No one reaches another's tenancy through the door (stratus.adoc D14).
