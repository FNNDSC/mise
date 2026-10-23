---
"@fnndsc/stratus": minor
"@fnndsc/argus": minor
---

A domain's build now puts ChRIS on its cluster and checks it end to end, once the cluster has settled.

The steps after the install are no longer placeholders. `verify` runs the ten checks and asks again each minute, for up to 30, while a new cluster's operators settle. `chris-deploy` installs the fnndsc/chris chart with `helm`, pinned to one node. `chris-seed` makes the test user and the smoke plugins through chrisomatic. `smoke` runs miniChRIS-OKD's journey against the public Route. BUILD and `tenant.mise` now build all the way through `smoke`, and the Kubernetes client waits out the 429 a settling API answers.
