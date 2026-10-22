---
'@fnndsc/stratus': minor
---

A domain built by harbor-oci shows under the session home; `domain status` says where each build step stands.

`stratus --domain harbor=~/src/harbor-oci` puts `domains/harbor/` under the tenancy: `spec.yaml`, `settings` (no credentials), `state.json` (the ISO link's URL withheld), `steps/<nn-name>/` with each step's `state` and the `evidence` it rests on (`unknown` where the host keeps none), and `auth/`, whose files are refused with their host path. `domain status [<name>]` prints the same with the compartment's live resource counts; a verb that would start a host program is refused by name.
