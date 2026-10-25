---
"@fnndsc/stratus": patch
---

A domain teardown now finishes, and runs again where it stopped (#1270). The first real teardown (quay) removed everything that bills, then failed: Red Hat would not delete the installer's infra-env while its 3 hosts were registered to it. The installer's hosts are now deregistered first, then the infra-env, then the cluster.

A teardown that stopped part way can be run again. When the stack holds nothing (an earlier pass destroyed it, and the cluster with it), it runs no destroy job and does not ask the gone cluster for its volumes, which used to refuse the run; the preview says so. The DNS records, the image and the installer's records are removed again, and each is no error when it is already gone.
