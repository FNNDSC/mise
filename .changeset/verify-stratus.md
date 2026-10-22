---
"@fnndsc/stratus": minor
---

A domain's cluster can now be verified from the session, by harbor-oci's ten checks, without `oc` or `dig`. Its ten checks are the API's `/readyz`, the cluster version, nodes Ready, the OCI cloud controller (providerIDs, shapes, zones), operators settled, the default storage class, the three DNS records from a public resolver, the console over the router's CA, CPU headroom for a plugin job, and a block-volume probe. Nine only read; the probe makes a 50 GiB claim and a pod and deletes them, so it runs only under the `tasks` tier and otherwise says so. The kubeconfig is read on the host and never leaves it. The result is kept as the domain's verify step, so `domain status` and the DOMAINS tile show it. Adoption now keeps the load balancers' addresses from the state's outputs. A `--fake` daemon verifies against a fake healthy cluster.
